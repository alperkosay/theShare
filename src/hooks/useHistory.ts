import { useSyncExternalStore } from 'react';
import { dbClear, dbDelete, dbGet, dbGetAll, dbPut } from '../lib/storage/db';
import {
  TEXT_PREVIEW_LENGTH,
  expiredEntries,
  planCopy,
  type HistoryEntry,
  type ResendRecord,
} from '../lib/storage/history';
import { handleOf, recordOf, resolveRecord, type ResolveResult } from '../lib/storage/resend';
import type { TransferRecord } from '../lib/transfer/manager';
import { profile } from './useProfile';
import { session, type RecordContext } from './useSession';

/** Files waiting for a connection (or for the current send to finish). In memory only. */
export interface PendingSend {
  id: string;
  files: File[];
}

export interface HistorySnapshot {
  loaded: boolean;
  /** Newest first. */
  entries: HistoryEntry[];
  pending: PendingSend[];
  /** Bytes used by resend copies (handles cost nothing). */
  copyBytes: number;
}

type CopyIndex = Array<{ key: string; at: number; bytes: number }>;

/**
 * Transfer history, resend and the pending queue. All of it lives in this
 * device's IndexedDB (lib/storage/db) and is never sent anywhere.
 */
class HistoryStore {
  private state: HistorySnapshot = { loaded: false, entries: [], pending: [], copyBytes: 0 };
  private listeners = new Set<() => void>();
  private copies: CopyIndex = [];
  /** Serialises writes so eviction decisions see each other. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    session.onRecord = (record, context) => void this.serial(() => this.record(record, context));
    // Pending files go out as soon as a connection is up and nothing else is being sent.
    session.subscribe(() => queueMicrotask(() => this.flushPending()));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<HistorySnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private serial<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => {});
    return next;
  }

  private setCopies(copies: CopyIndex) {
    this.copies = copies;
    this.set({ copyBytes: copies.reduce((sum, c) => sum + c.bytes, 0) });
  }

  // ---------------------------------------------------------------------------

  /** Reads the history, dropping entries past the retention period and orphaned files. */
  load(): Promise<void> {
    return this.serial(async () => {
      if (!profile.persistent) return this.set({ loaded: true });
      try {
        const all = (await dbGetAll<HistoryEntry>('history')).sort((a, b) => b.at - a.at);
        const expired = new Set(expiredEntries(all, profile.getSnapshot().settings.retentionDays).map((e) => e.id));
        for (const id of expired) await dbDelete('history', id);
        const entries = all.filter((e) => !expired.has(e.id));

        const used = new Set(entries.map((e) => e.resendKey).filter(Boolean));
        const copies: CopyIndex = [];
        for (const r of await dbGetAll<ResendRecord>('files')) {
          if (!used.has(r.key)) await dbDelete('files', r.key);
          else if (r.mode === 'copy') copies.push({ key: r.key, at: r.at, bytes: r.bytes });
        }
        this.setCopies(copies);
        this.set({ loaded: true, entries });
      } catch {
        this.set({ loaded: true });
      }
    });
  }

  private async record(r: TransferRecord, context: RecordContext): Promise<void> {
    const { settings } = profile.getSnapshot();
    if (!profile.persistent || !settings.keepHistory) return;
    if (r.kind === 'text' && !settings.includeTexts) return;
    const { peer, peerName, method } = context;
    const entry: HistoryEntry = {
      id: r.id,
      at: r.at,
      direction: r.direction,
      kind: r.kind,
      totalBytes: r.totalBytes,
      status: r.status,
      peer: {
        ...(peer?.id ? { id: peer.id } : {}),
        name: peer?.name ?? peerName ?? 'Bilinmeyen cihaz',
        kind: peer?.kind ?? 'computer',
        os: peer?.os ?? 'other',
      },
      method,
      ...(r.files ? { files: r.files.map(({ name, size, type }) => ({ name, size, type })) } : {}),
      ...(r.text ? { textPreview: r.text.slice(0, TEXT_PREVIEW_LENGTH) } : {}),
    };
    if (r.direction === 'out' && r.sources?.length) {
      const key = await this.keepForResend(r.id, r.at, r.sources, settings.keepFiles).catch(() => undefined);
      if (key) entry.resendKey = key;
    }
    try {
      await dbPut('history', entry);
    } catch {
      return;
    }
    this.set({ entries: [entry, ...this.state.entries.filter((e) => e.id !== entry.id)].sort((a, b) => b.at - a.at) });
  }

  /** Stores handles (free) or, if allowed and within the quota, copies. Returns the record key. */
  private async keepForResend(id: string, at: number, files: File[], keepCopies: boolean): Promise<string | undefined> {
    // A resend of stored files: point at the same record.
    const reused = recordOf(files[0]!);
    if (reused && files.every((f) => recordOf(f) === reused) && (await dbGet('files', reused))) return reused;

    const fileHandles = files.map(handleOf);
    if (fileHandles.every((h): h is FileSystemFileHandle => h !== undefined)) {
      await dbPut('files', { key: id, at, bytes: 0, mode: 'handle', items: fileHandles } satisfies ResendRecord);
      return id;
    }
    if (!keepCopies) return undefined;
    const plan = planCopy(this.copies, files);
    if (!plan) return undefined;
    for (const key of plan.evict) await this.forgetFiles(key);
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    await dbPut('files', { key: id, at, bytes, mode: 'copy', items: files } satisfies ResendRecord);
    this.setCopies([...this.copies, { key: id, at, bytes }]);
    return id;
  }

  /** Deletes a files record and unlinks the entries that pointed at it. */
  private async forgetFiles(key: string): Promise<void> {
    await dbDelete('files', key);
    this.setCopies(this.copies.filter((c) => c.key !== key));
    const entries: HistoryEntry[] = [];
    for (const e of this.state.entries) {
      if (e.resendKey !== key) {
        entries.push(e);
        continue;
      }
      const { resendKey: _, ...rest } = e;
      await dbPut('history', rest);
      entries.push(rest);
    }
    this.set({ entries });
  }

  // ---------------------------------------------------------------------------
  // Settings actions
  // ---------------------------------------------------------------------------

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      const entry = this.state.entries.find((e) => e.id === id);
      if (!entry) return;
      await dbDelete('history', id);
      this.set({ entries: this.state.entries.filter((e) => e.id !== id) });
      const key = entry.resendKey;
      if (key && !this.state.entries.some((e) => e.resendKey === key)) await this.forgetFiles(key);
    });
  }

  clear(): Promise<void> {
    return this.serial(async () => {
      await dbClear('history');
      await dbClear('files');
      this.setCopies([]);
      this.set({ entries: [] });
    });
  }

  clearFiles(): Promise<void> {
    return this.serial(async () => {
      await dbClear('files');
      this.setCopies([]);
      const entries = this.state.entries.map(({ resendKey: _, ...rest }) => rest);
      for (const e of entries) await dbPut('history', e);
      this.set({ entries });
    });
  }

  /** After "reset everything" deleted the database. */
  forgetAll(): void {
    this.copies = [];
    this.set({ entries: [], pending: [], copyBytes: 0 });
  }

  // ---------------------------------------------------------------------------
  // Resend & pending queue
  // ---------------------------------------------------------------------------

  /** Loads an entry's stored files. Call from a click: handles may ask for permission. */
  async resolve(entry: HistoryEntry): Promise<ResolveResult> {
    const record = entry.resendKey ? await dbGet<ResendRecord>('files', entry.resendKey).catch(() => undefined) : undefined;
    if (!record) return { error: 'Saklanan dosya bulunamadı. Dosyayı yeniden seçin.' };
    return resolveRecord(record);
  }

  /** Stored copies of an entry's files, for previews (handles would need a permission prompt). */
  async copiesOf(entry: HistoryEntry): Promise<File[]> {
    if (!entry.resendKey) return [];
    const record = await dbGet<ResendRecord>('files', entry.resendKey).catch(() => undefined);
    return record?.mode === 'copy' ? record.items : [];
  }

  /** Sends now if possible, otherwise queues until connected. Returns what happened, or an error message. */
  send(files: File[]): { sent: boolean } | { error: string } {
    if (session.getSnapshot().linkState === 'connected' && session.manager?.canSend) {
      const error = session.sendFiles(files);
      return error ? { error } : { sent: true };
    }
    this.set({ pending: [...this.state.pending, { id: crypto.randomUUID(), files }] });
    return { sent: false };
  }

  removePending(id: string): void {
    this.set({ pending: this.state.pending.filter((p) => p.id !== id) });
  }

  private flushPending(): void {
    const [next, ...rest] = this.state.pending;
    if (!next || session.getSnapshot().linkState !== 'connected' || !session.manager?.canSend) return;
    // Dropped from the queue either way: an error here (e.g. over the file limit) won't fix itself.
    this.set({ pending: rest });
    session.sendFiles(next.files);
  }
}

export const history = new HistoryStore();

export function useHistory(): HistorySnapshot {
  return useSyncExternalStore(history.subscribe, history.getSnapshot);
}

/** "Reset everything": history, stored files, name, device id and settings. */
export async function resetEverything(): Promise<void> {
  history.forgetAll();
  await profile.reset();
}
