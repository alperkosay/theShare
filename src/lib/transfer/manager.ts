import type { PeerLink } from '../webrtc/peer';
import {
  MAX_FILES_PER_TRANSFER,
  PROTOCOL_VERSION,
  newTransferId,
  parseControl,
  sanitizeFileName,
  type ControlMessage,
  type FileMeta,
} from './protocol';
import {
  canSaveToDisk,
  cleanupTemporaryFiles,
  createBrowserSinkFactory,
  pickDiskTarget,
  type FileSink,
  type SinkFactory,
  type SinkKind,
} from './sinks';

/**
 * Drives file transfers over a connected PeerLink: one outgoing and one
 * incoming transfer at a time (the channel is full-duplex, so both can run
 * simultaneously), with two layers of flow control:
 *
 *  1. Sender-side backpressure: pause while `bufferedAmount` > BUFFER_HIGH,
 *     resume on `bufferedamountlow`.
 *  2. Receiver window: the receiver acks bytes only after writing them to the
 *     sink, and the sender never runs more than ACK_WINDOW ahead. Without it
 *     a slow disk would let incoming chunks pile up in the receiver's memory.
 */

const CHUNK_SMALL = 16 * 1024;
const CHUNK_LARGE = 64 * 1024;
const READ_BLOCK = 1024 * 1024;
const BUFFER_HIGH = 4 * 1024 * 1024;
const BUFFER_LOW = 1024 * 1024;
const ACK_EVERY = 1024 * 1024;
const ACK_WINDOW = 8 * 1024 * 1024;
const TICK_MS = 250;
const SAVE_TO_DISK_ABOVE = 1024 * 1024 * 1024;

export type TransferStatus = 'pending' | 'active' | 'finishing' | 'done' | 'rejected' | 'cancelled' | 'failed';

export interface ReceivedFile {
  name: string;
  size: number;
  declaredType: string;
  /** null when it was written directly to a user-picked location on disk. */
  file: File | null;
  downloaded: boolean;
}

export interface TransferView {
  id: string;
  direction: 'out' | 'in';
  files: FileMeta[];
  totalBytes: number;
  transferredBytes: number;
  currentIndex: number;
  status: TransferStatus;
  /** Bytes per second, smoothed. */
  speed: number;
  error: string | null;
  sinkKind: SinkKind | null;
  received: ReceivedFile[];
  createdAt: number;
  finishedAt: number | null;
}

interface Base extends TransferView {
  lastSampleAt: number;
  lastSampleBytes: number;
}

interface Outgoing extends Base {
  direction: 'out';
  sources: File[];
  sentBytes: number;
}

interface Incoming extends Base {
  direction: 'in';
  factory: SinkFactory | null;
  sink: FileSink | null;
  /** Index of the file currently being received (set synchronously on file-start). */
  receivingIndex: number | null;
  nextIndex: number;
  /** Bytes received for the current file (validated against the declared size). */
  fileBytes: number;
  lastAckBytes: number;
  /** Serialises sink operations so writes happen in order. */
  queue: Promise<void>;
}

type Transfer = Outgoing | Incoming;

const isOpen = (s: TransferStatus) => s === 'pending' || s === 'active' || s === 'finishing';

export class TransferManager {
  onChange: (transfers: TransferView[]) => void = () => {};
  onPeerLeft: () => void = () => {};

  private transfers: Transfer[] = [];
  private dirty = false;
  private wakers: Array<() => void> = [];
  private objectUrls: string[] = [];
  private readonly ticker: ReturnType<typeof setInterval>;
  private readonly onBufferLow = () => this.wake();

  constructor(private readonly link: PeerLink) {
    link.channel.bufferedAmountLowThreshold = BUFFER_LOW;
    link.channel.addEventListener('bufferedamountlow', this.onBufferLow);
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.sendControl({ t: 'hello', v: PROTOCOL_VERSION });
  }

  get views(): TransferView[] {
    return this.transfers.map(toView);
  }

  get hasActiveTransfer(): boolean {
    return this.transfers.some((t) => t.status === 'active' || t.status === 'finishing');
  }

  get canSend(): boolean {
    return !this.transfers.some((t) => t.direction === 'out' && isOpen(t.status));
  }

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  /** Offers files to the peer; the transfer starts once they accept. */
  sendFiles(files: File[]): void {
    if (!this.canSend) throw new Error('Önceki gönderim bitmeden yeni gönderim başlatılamaz.');
    if (files.length === 0) return;
    if (files.length > MAX_FILES_PER_TRANSFER) {
      throw new Error(`Tek seferde en fazla ${MAX_FILES_PER_TRANSFER} dosya gönderilebilir.`);
    }
    const metas = files.map((f) => ({ name: sanitizeFileName(f.name), size: f.size, type: f.type }));
    const t: Outgoing = {
      ...baseFields(newTransferId(), metas),
      direction: 'out',
      sources: files,
      sentBytes: 0,
    };
    this.transfers.unshift(t);
    this.sendControl({ t: 'offer', id: t.id, files: metas });
    this.markDirty(true);
  }

  /**
   * Accepts an incoming offer. Large transfers on browsers that support it go
   * straight to a file the user picks (nothing piles up in memory), so this
   * must be called directly from a click handler for the picker to open.
   * Resolves to false if the user dismissed the picker (offer stays pending).
   */
  async accept(id: string): Promise<boolean> {
    const t = this.find(id, 'in');
    if (!t || t.status !== 'pending') return false;
    let factory: SinkFactory;
    if (canSaveToDisk() && t.totalBytes > SAVE_TO_DISK_ABOVE) {
      try {
        factory = await pickDiskTarget(t.files);
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return false;
        factory = await createBrowserSinkFactory(t.id, t.totalBytes);
      }
    } else {
      factory = await createBrowserSinkFactory(t.id, t.totalBytes);
    }
    if (t.status !== 'pending') return false; // cancelled while the picker was open
    t.factory = factory;
    t.sinkKind = factory.kind;
    this.setStatus(t, 'active');
    this.sendControl({ t: 'accept', id });
    return true;
  }

  reject(id: string): void {
    const t = this.find(id, 'in');
    if (!t || t.status !== 'pending') return;
    this.setStatus(t, 'rejected');
    this.sendControl({ t: 'reject', id });
  }

  cancel(id: string): void {
    const t = this.transfers.find((x) => x.id === id);
    if (!t || !isOpen(t.status)) return;
    if (t.direction === 'in' && t.status === 'pending') return this.reject(id);
    this.sendControl({ t: 'cancel', id });
    this.finish(t, 'cancelled', 'Aktarım iptal edildi.');
  }

  /** Triggers a download of a received file (always a user-initiated action). */
  download(id: string, index: number): void {
    const t = this.find(id, 'in');
    const r = t?.received[index];
    if (!t || !r?.file) return;
    const url = URL.createObjectURL(r.file);
    this.objectUrls.push(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    r.downloaded = true;
    this.markDirty(true);
  }

  /** Sends a goodbye so the peer can show "the other side left" instead of a generic error. */
  sayGoodbye(): void {
    this.sendControl({ t: 'bye' });
  }

  /** Called when the underlying connection is gone. */
  handleDisconnect(message: string): void {
    for (const t of this.transfers) {
      if (isOpen(t.status)) this.finish(t, 'failed', message);
    }
  }

  /** Ends the session: aborts everything and frees memory, object URLs and temporary files. */
  dispose(): void {
    clearInterval(this.ticker);
    this.link.channel.removeEventListener('bufferedamountlow', this.onBufferLow);
    for (const t of this.transfers) {
      if (isOpen(t.status)) this.finish(t, 'cancelled', null);
    }
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.transfers = [];
    this.wake();
    void cleanupTemporaryFiles();
  }

  // ---------------------------------------------------------------------------
  // Incoming messages
  // ---------------------------------------------------------------------------

  handleMessage(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') return this.handleChunk(data);
    const msg = parseControl(data);
    if (!msg) {
      console.warn('[theshare] ignoring malformed control message');
      return;
    }
    this.handleControl(msg);
  }

  private handleControl(msg: ControlMessage): void {
    switch (msg.t) {
      case 'hello':
        if (msg.v !== PROTOCOL_VERSION) console.warn('[theshare] peer protocol version', msg.v);
        return;
      case 'bye':
        this.onPeerLeft();
        return;
      case 'offer':
        return this.handleOffer(msg.id, msg.files);
      case 'accept': {
        const t = this.find(msg.id, 'out');
        if (t?.status === 'pending') {
          this.setStatus(t, 'active');
          void this.run(t);
        }
        return;
      }
      case 'reject': {
        const t = this.find(msg.id, 'out');
        if (t && isOpen(t.status)) {
          this.finish(t, 'rejected', msg.reason === 'busy' ? 'Alıcı şu anda başka bir aktarımı işliyor.' : 'Alıcı aktarımı reddetti.');
        }
        return;
      }
      case 'ack': {
        const t = this.find(msg.id, 'out');
        if (t && msg.bytes <= t.sentBytes && msg.bytes > t.transferredBytes) {
          t.transferredBytes = msg.bytes;
          this.markDirty();
          this.wake();
        }
        return;
      }
      case 'complete': {
        const t = this.find(msg.id, 'out');
        if (t && isOpen(t.status)) {
          t.transferredBytes = t.totalBytes;
          this.finish(t, 'done', null);
        }
        return;
      }
      case 'cancel': {
        const t = this.transfers.find((x) => x.id === msg.id);
        if (t && isOpen(t.status)) this.finish(t, 'cancelled', msg.reason ?? 'Karşı taraf aktarımı iptal etti.');
        return;
      }
      case 'file-start':
        return this.handleFileStart(msg.id, msg.index);
      case 'file-end':
        return this.handleFileEnd(msg.id, msg.index);
    }
  }

  private handleOffer(id: string, files: FileMeta[]): void {
    if (this.transfers.some((t) => t.id === id)) return;
    if (this.transfers.some((t) => t.direction === 'in' && isOpen(t.status))) {
      this.sendControl({ t: 'reject', id, reason: 'busy' });
      return;
    }
    const t: Incoming = {
      ...baseFields(id, files),
      direction: 'in',
      factory: null,
      sink: null,
      receivingIndex: null,
      nextIndex: 0,
      fileBytes: 0,
      lastAckBytes: 0,
      queue: Promise.resolve(),
    };
    if (!Number.isSafeInteger(t.totalBytes)) {
      this.sendControl({ t: 'reject', id });
      return;
    }
    this.transfers.unshift(t);
    this.markDirty(true);
  }

  private activeIncoming(id?: string): Incoming | undefined {
    return this.transfers.find(
      (t): t is Incoming => t.direction === 'in' && t.status === 'active' && (id === undefined || t.id === id),
    );
  }

  private handleFileStart(id: string, index: number): void {
    const t = this.activeIncoming(id);
    if (!t) return;
    if (t.receivingIndex !== null || index !== t.nextIndex || index >= t.files.length) {
      return this.protocolError(t);
    }
    t.receivingIndex = index;
    t.currentIndex = index;
    t.fileBytes = 0;
    this.enqueue(t, async () => {
      const sink = await t.factory!.open(t.files[index]!, index);
      if (t.status === 'active') t.sink = sink;
      else await sink.abort(); // cancelled while opening
    });
  }

  private handleChunk(chunk: ArrayBuffer): void {
    // Late chunks of a transfer cancelled by us arrive here too; they are dropped.
    const t = this.activeIncoming();
    if (!t || t.receivingIndex === null) return;
    const meta = t.files[t.receivingIndex]!;
    t.fileBytes += chunk.byteLength;
    if (t.fileBytes > meta.size) return this.protocolError(t);
    this.enqueue(t, async () => {
      await t.sink!.write(chunk);
      t.transferredBytes += chunk.byteLength;
      if (t.transferredBytes - t.lastAckBytes >= ACK_EVERY) this.ack(t);
      this.markDirty();
    });
  }

  private handleFileEnd(id: string, index: number): void {
    const t = this.activeIncoming(id);
    if (!t) return;
    const meta = t.files[index];
    if (!meta || index !== t.receivingIndex || t.fileBytes !== meta.size) return this.protocolError(t);
    t.receivingIndex = null; // stray chunks until the next file-start are dropped
    t.nextIndex = index + 1;
    this.enqueue(t, async () => {
      const result = await t.sink!.close();
      t.sink = null;
      t.received.push({ name: meta.name, size: meta.size, declaredType: meta.type, file: result.file, downloaded: false });
      this.ack(t);
      if (t.received.length === t.files.length) {
        this.sendControl({ t: 'complete', id: t.id });
        this.finish(t, 'done', null);
      } else {
        this.markDirty(true);
      }
    });
  }

  private enqueue(t: Incoming, op: () => Promise<void>): void {
    t.queue = t.queue
      .then(() => (t.status === 'active' ? op() : undefined))
      .catch((e: unknown) => {
        if (t.status !== 'active') return;
        const quota = (e as DOMException)?.name === 'QuotaExceededError';
        const message = quota ? 'Cihazda yeterli depolama alanı yok.' : 'Gelen dosya kaydedilemedi.';
        this.sendControl({ t: 'cancel', id: t.id, reason: `Alıcı tarafta hata: ${message}` });
        this.finish(t, 'failed', message);
      });
  }

  private ack(t: Incoming): void {
    t.lastAckBytes = t.transferredBytes;
    this.sendControl({ t: 'ack', id: t.id, bytes: t.transferredBytes });
  }

  private protocolError(t: Transfer): void {
    this.sendControl({ t: 'cancel', id: t.id, reason: 'Protokol hatası.' });
    this.finish(t, 'failed', 'Beklenmeyen veri alındı, aktarım durduruldu.');
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  private async run(t: Outgoing): Promise<void> {
    const chunkSize = this.link.maxMessageSize >= CHUNK_LARGE ? CHUNK_LARGE : CHUNK_SMALL;
    try {
      for (let i = 0; i < t.sources.length; i++) {
        const file = t.sources[i]!;
        t.currentIndex = i;
        this.sendControl({ t: 'file-start', id: t.id, index: i });
        for (let offset = 0; offset < file.size; offset += READ_BLOCK) {
          let block: ArrayBuffer;
          try {
            block = await file.slice(offset, offset + READ_BLOCK).arrayBuffer();
          } catch {
            throw new Error(`"${file.name}" okunamadı. Dosya taşınmış ya da silinmiş olabilir.`);
          }
          for (let pos = 0; pos < block.byteLength; pos += chunkSize) {
            await this.waitForCapacity(t);
            if (t.status !== 'active') return;
            const chunk = new Uint8Array(block, pos, Math.min(chunkSize, block.byteLength - pos));
            this.link.sendBinary(chunk);
            t.sentBytes += chunk.byteLength;
          }
        }
        if (t.status !== 'active') return;
        this.sendControl({ t: 'file-end', id: t.id, index: i });
      }
      this.setStatus(t, 'finishing'); // waiting for the receiver's "complete"
    } catch (e) {
      if (t.status !== 'active') return;
      const message = e instanceof Error && e.message.includes('okunamadı') ? e.message : 'Veri gönderilemedi, bağlantı kopmuş olabilir.';
      this.sendControl({ t: 'cancel', id: t.id, reason: 'Gönderen tarafta hata.' });
      this.finish(t, 'failed', message);
    }
  }

  private async waitForCapacity(t: Outgoing): Promise<void> {
    const channel = this.link.channel;
    while (t.status === 'active' && (channel.bufferedAmount > BUFFER_HIGH || t.sentBytes - t.transferredBytes > ACK_WINDOW)) {
      if (channel.readyState !== 'open') throw new Error('channel closed');
      // Woken by bufferedamountlow / ack / cancel; the timeout is a safety net.
      await new Promise<void>((resolve) => {
        this.wakers.push(resolve);
        setTimeout(resolve, TICK_MS);
      });
    }
  }

  private wake(): void {
    const wakers = this.wakers;
    this.wakers = [];
    for (const w of wakers) w();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private sendControl(msg: ControlMessage): void {
    try {
      if (this.link.channel.readyState === 'open') this.link.sendText(JSON.stringify(msg));
    } catch {
      // Channel closing; the disconnect handler reports it.
    }
  }

  private find(id: string, direction: 'in'): Incoming | undefined;
  private find(id: string, direction: 'out'): Outgoing | undefined;
  private find(id: string, direction: 'in' | 'out'): Transfer | undefined {
    return this.transfers.find((t) => t.id === id && t.direction === direction);
  }

  private setStatus(t: Transfer, status: TransferStatus): void {
    t.status = status;
    if (status === 'active') {
      t.lastSampleAt = performance.now();
      t.lastSampleBytes = t.transferredBytes;
    }
    this.markDirty(true);
  }

  private finish(t: Transfer, status: TransferStatus, error: string | null): void {
    t.status = status;
    t.error = error;
    t.speed = 0;
    t.finishedAt = Date.now();
    if (t.direction === 'in') {
      const sink = t.sink;
      t.sink = null;
      if (status !== 'done' && sink) void sink.abort();
    }
    this.wake();
    this.markDirty(true);
  }

  private markDirty(immediate = false): void {
    this.dirty = true;
    if (immediate) this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.onChange(this.views);
  }

  private tick(): void {
    const now = performance.now();
    for (const t of this.transfers) {
      if (t.status !== 'active') continue;
      const dt = (now - t.lastSampleAt) / 1000;
      if (dt <= 0) continue;
      const instant = (t.transferredBytes - t.lastSampleBytes) / dt;
      t.speed = t.speed === 0 ? instant : t.speed * 0.75 + instant * 0.25;
      t.lastSampleAt = now;
      t.lastSampleBytes = t.transferredBytes;
      this.dirty = true;
    }
    this.flush();
  }
}

function baseFields(id: string, files: FileMeta[]): Base {
  return {
    id,
    direction: 'out',
    files,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    transferredBytes: 0,
    currentIndex: 0,
    status: 'pending',
    speed: 0,
    error: null,
    sinkKind: null,
    received: [],
    createdAt: Date.now(),
    finishedAt: null,
    lastSampleAt: 0,
    lastSampleBytes: 0,
  };
}

function toView(t: Transfer): TransferView {
  return {
    id: t.id,
    direction: t.direction,
    files: t.files,
    totalBytes: t.totalBytes,
    transferredBytes: t.transferredBytes,
    currentIndex: t.currentIndex,
    status: t.status,
    speed: t.speed,
    error: t.error,
    sinkKind: t.sinkKind,
    received: t.received.map((r) => ({ ...r })),
    createdAt: t.createdAt,
    finishedAt: t.finishedAt,
  };
}
