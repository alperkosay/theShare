import { STUN_SERVERS } from '../webrtc/peer';
import { deriveRoom, randomId, seal, TrackerPool, unseal, type TrackerMessage } from './tracker';

/**
 * Nearby-device discovery without a server of our own.
 *
 * Browsers can't scan the local network. What devices on the same Wi-Fi do
 * share is their public IP address (they sit behind the same router). Each
 * device learns its public IP from a STUN server, derives a room from it and
 * joins that room on the public WebTorrent trackers. Inside the room, devices
 * periodically broadcast an encrypted "hello" (name + device type) and see
 * each other. Connecting is an explicit request the other side must accept;
 * the WebRTC offer/answer travel in those request/response messages.
 *
 * Limits, by design of this approach:
 *  - "Same public IP" ≠ "same room": on mobile data (carrier-grade NAT) or big
 *    shared networks, unrelated people can share an IP and see each other's
 *    random device names. They still can't connect without being accepted.
 *  - Anyone who knows your public IP can derive the room. Same mitigation.
 *  - Needs internet: the STUN server learns your public IP (like any website).
 */


const HELLO_EVERY_MS = 4_000;
const DEVICE_TTL_MS = 15_000;
/** Each hello copy reaches one random member; several copies reach a whole household per round. */
const HELLO_COPIES = 6;
/** Offer ids the target sent us recently; replying to them is how we reach that device directly. */
const MAX_REPLY_IDS = 24;
const REQUEST_TIMEOUT_MS = 60_000;
const PUBLIC_IP_TIMEOUT_MS = 6_000;

export type DeviceKind = 'phone' | 'tablet' | 'computer';

export interface NearbyDevice {
  id: string;
  name: string;
  kind: DeviceKind;
}

export interface IncomingRequest {
  requestId: string;
  from: NearbyDevice;
  offer: string;
}

type Message =
  | { t: 'hello'; name: string; kind: DeviceKind }
  | { t: 'request'; rid: string; name: string; kind: DeviceKind; offer: string }
  | { t: 'response'; rid: string; accept: boolean; answer?: string }
  | { t: 'cancel'; rid: string };

function parseMessage(text: string | null): Message | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    const name = typeof m.name === 'string' ? m.name.slice(0, 40) : '';
    const kind: DeviceKind = m.kind === 'phone' || m.kind === 'tablet' ? m.kind : 'computer';
    const rid = typeof m.rid === 'string' && m.rid.length <= 40 ? m.rid : null;
    switch (m.t) {
      case 'hello':
        return name ? { t: 'hello', name, kind } : null;
      case 'request':
        return rid && name && typeof m.offer === 'string' ? { t: 'request', rid, name, kind, offer: m.offer } : null;
      case 'response':
        return rid && typeof m.accept === 'boolean'
          ? { t: 'response', rid, accept: m.accept, ...(typeof m.answer === 'string' ? { answer: m.answer } : {}) }
          : null;
      case 'cancel':
        return rid ? { t: 'cancel', rid } : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Expands an IPv6 address and returns its /64 prefix (what devices on one LAN share). */
export function ipv6Prefix(address: string): string | null {
  const [head = '', tail] = address.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':');
}

/**
 * Learns this network's public address via STUN ("server-reflexive" ICE candidate).
 * Returns a network id like "v4:85.100.1.2" or "v6:2a02:…" (/64), or null if offline.
 */
export async function detectNetworkId(timeoutMs = PUBLIC_IP_TIMEOUT_MS): Promise<string | null> {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVERS }] });
  try {
    pc.createDataChannel('probe');
    const found = new Promise<string | null>((resolve) => {
      let v6: string | null = null;
      const timer = setTimeout(() => resolve(v6), timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          resolve(v6);
          return;
        }
        const c = e.candidate;
        const address = c.address ?? c.candidate.split(' ')[4] ?? '';
        if (c.type !== 'srflx' || !address) return;
        if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
          clearTimeout(timer);
          resolve(`v4:${address}`); // prefer IPv4: one address per household
        } else {
          const prefix = ipv6Prefix(address);
          if (prefix) v6 ??= `v6:${prefix}`;
        }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await found;
  } catch {
    return null;
  } finally {
    pc.close();
  }
}

export interface NearbyHandlers {
  onDevices: (devices: NearbyDevice[]) => void;
  onRequest: (request: IncomingRequest) => void;
  onRequestCancelled: (requestId: string) => void;
  onUnavailable: () => void;
}

interface Known extends NearbyDevice {
  lastSeen: number;
  /** [socket, offer_id] pairs we can answer to reach this device. */
  replyIds: Array<[WebSocket, string]>;
}

export class NearbyNetwork {
  readonly selfId = randomId();
  private pool: TrackerPool | null = null;
  private infoHash = '';
  private key: CryptoKey | null = null;
  private devices = new Map<string, Known>();
  private seenRequests = new Set<string>();
  private pending = new Map<string, { resolve: (answer: string | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;

  constructor(
    private readonly self: { name: string; kind: DeviceKind },
    private readonly handlers: NearbyHandlers,
  ) {}

  async start(): Promise<void> {
    const networkId = await detectNetworkId();
    if (this.stopped) return;
    if (!networkId) return this.handlers.onUnavailable();
    const room = await deriveRoom(networkId, 'nearby');
    if (this.stopped) return;
    this.infoHash = room.infoHash;
    this.key = room.key;
    this.pool = new TrackerPool(
      (socket) => void this.announce(socket),
      (msg, socket) => void this.receive(msg, socket),
      () => this.handlers.onUnavailable(),
    );
    this.timer = setInterval(() => {
      this.pool?.each((s) => void this.announce(s));
      this.expire();
    }, HELLO_EVERY_MS);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.pool?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    this.pending.clear();
  }

  /**
   * Asks a device to connect, carrying our WebRTC offer.
   * Resolves with their answer, or null if declined / timed out / unreachable.
   */
  request(deviceId: string, offer: string): { requestId: string; answer: Promise<string | null> } {
    const requestId = randomId();
    const answer = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
    });
    void this.direct(deviceId, { t: 'request', rid: requestId, name: this.self.name, kind: this.self.kind, offer });
    return { requestId, answer };
  }

  cancelRequest(deviceId: string, requestId: string): void {
    const p = this.pending.get(requestId);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(requestId);
      p.resolve(null);
    }
    void this.direct(deviceId, { t: 'cancel', rid: requestId });
  }

  respond(deviceId: string, requestId: string, answer: string | null): void {
    void this.direct(deviceId, { t: 'response', rid: requestId, accept: answer !== null, ...(answer ? { answer } : {}) });
  }

  // ---------------------------------------------------------------------------

  private async announce(socket: WebSocket): Promise<void> {
    if (!this.key || !this.pool) return;
    const hello = await seal(this.key, JSON.stringify({ t: 'hello', name: this.self.name, kind: this.self.kind }));
    this.pool.send(socket, {
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.selfId,
      numwant: HELLO_COPIES,
      uploaded: 0,
      downloaded: 0,
      event: 'started',
      offers: Array.from({ length: HELLO_COPIES }, () => ({ offer_id: randomId(), offer: { type: 'offer', sdp: hello } })),
    });
  }

  /** Sends a message to one device by answering one of its recent hello offers (on every tracker we can). */
  private async direct(deviceId: string, message: Message): Promise<void> {
    // Right after a device appears we may not hold any of its offer ids yet; its next hello brings some.
    for (let waited = 0; !this.devices.get(deviceId)?.replyIds.length && waited < 2 * HELLO_EVERY_MS; waited += 250) {
      if (this.stopped) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    const device = this.devices.get(deviceId);
    if (!device || !this.key || !this.pool) return;
    const sealed = await seal(this.key, JSON.stringify(message));
    const usedSockets = new Set<WebSocket>();
    // Newest first; one offer id per tracker (ids may be single-use).
    for (let i = device.replyIds.length - 1; i >= 0; i--) {
      const [socket, offerId] = device.replyIds[i]!;
      if (usedSockets.has(socket) || socket.readyState !== WebSocket.OPEN) continue;
      usedSockets.add(socket);
      device.replyIds.splice(i, 1);
      this.pool.send(socket, {
        action: 'announce',
        info_hash: this.infoHash,
        peer_id: this.selfId,
        to_peer_id: deviceId,
        offer_id: offerId,
        answer: { type: 'answer', sdp: sealed },
      });
    }
  }

  private async receive(msg: TrackerMessage, socket: WebSocket): Promise<void> {
    if (!this.key || msg.info_hash !== this.infoHash) return;
    const from = msg.peer_id;
    if (typeof from !== 'string' || from === this.selfId) return;
    const payload = msg.offer?.sdp ?? msg.answer?.sdp;
    const m = parseMessage(await unseal(this.key, payload));
    if (!m) return;

    if (msg.offer && m.t === 'hello') {
      const known = this.devices.get(from);
      const replyIds = known?.replyIds ?? [];
      if (typeof msg.offer_id === 'string') replyIds.push([socket, msg.offer_id]);
      if (replyIds.length > MAX_REPLY_IDS) replyIds.splice(0, replyIds.length - MAX_REPLY_IDS);
      const changed = !known || known.name !== m.name || known.kind !== m.kind;
      this.devices.set(from, { id: from, name: m.name, kind: m.kind, lastSeen: Date.now(), replyIds });
      if (changed) this.emitDevices();
      return;
    }
    if (!msg.answer) return;

    if (m.t === 'request') {
      // Requests are deduplicated: the same one arrives through several trackers.
      if (this.seenRequests.has(m.rid)) return;
      this.seenRequests.add(m.rid);
      this.handlers.onRequest({ requestId: m.rid, from: { id: from, name: m.name, kind: m.kind }, offer: m.offer });
    } else if (m.t === 'response') {
      const p = this.pending.get(m.rid);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.rid);
      p.resolve(m.accept && m.answer ? m.answer : null);
    } else if (m.t === 'cancel') {
      this.handlers.onRequestCancelled(m.rid);
    }
  }

  private expire(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > DEVICE_TTL_MS) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitDevices();
  }

  private emitDevices(): void {
    this.handlers.onDevices(
      [...this.devices.values()].map(({ id, name, kind }) => ({ id, name, kind })).sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    );
  }
}

// ---------------------------------------------------------------------------
// Device names
// ---------------------------------------------------------------------------

const ADJECTIVES = ['Mavi', 'Kırmızı', 'Yeşil', 'Mor', 'Turuncu', 'Sarı', 'Pembe', 'Turkuaz', 'Gri', 'Lacivert', 'Altın', 'Gümüş'];
const ANIMALS = ['Tilki', 'Kaplan', 'Baykuş', 'Yunus', 'Kartal', 'Panda', 'Kedi', 'Ceylan', 'Kunduz', 'Penguen', 'Sincap', 'Martı'];

export function randomDeviceName(): string {
  const pick = <T,>(list: T[]) => list[crypto.getRandomValues(new Uint32Array(1))[0]! % list.length]!;
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

export function detectDeviceKind(ua = navigator.userAgent): DeviceKind {
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/iPhone|Android|Mobile/i.test(ua)) return 'phone';
  return 'computer';
}
