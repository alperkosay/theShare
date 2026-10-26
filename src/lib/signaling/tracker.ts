/**
 * Shared plumbing for meeting other devices through public WebTorrent trackers
 * (used by 6-digit code pairing and nearby-device discovery).
 *
 * Trackers relay "offers" to random members of a swarm (identified by a
 * 20-character info hash) and "answers" back to a specific peer. We use those
 * messages as an encrypted mailbox; the actual WebRTC connection is ours.
 */

export const TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.novage.com.ua',
];

const PBKDF2_ITERATIONS = 200_000;
const MAX_MESSAGE = 128 * 1024;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
/** 20 characters, the id length trackers expect. */
export const randomId = () => hex(crypto.getRandomValues(new Uint8Array(10)));

export interface Room {
  infoHash: string;
  key: CryptoKey;
}

/**
 * Derives the swarm id and AES key from a shared value (the network id for
 * nearby devices). The swarm id is public, so a guessable value is given away
 * by it: fine for the network id (the public IP, which the tracker sees
 * anyway), not for a 6-digit code, which uses a PAKE instead
 * (lib/signaling/code-rendezvous).
 */
export async function deriveRoom(secret: string, purpose: string): Promise<Room> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(`theshare-${purpose}-v1`), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      512,
    ),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { infoHash: hex(bits.slice(0, 10)), key };
}

export async function seal(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

/** Returns null for anything not sealed with this key (other users, garbage). */
export async function unseal(key: CryptoKey, data: unknown): Promise<string | null> {
  if (typeof data !== 'string' || data.length > 64 * 1024) return null;
  try {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export interface TrackerMessage {
  info_hash?: unknown;
  peer_id?: unknown;
  offer_id?: unknown;
  offer?: { sdp?: unknown };
  answer?: { sdp?: unknown };
}

/** WebSockets to all trackers. Calls onAllFailed if none of them can be used. */
export class TrackerPool {
  private sockets: WebSocket[] = [];
  private failed = 0;
  private closed = false;

  constructor(
    onOpen: (socket: WebSocket) => void,
    onMessage: (msg: TrackerMessage, socket: WebSocket) => void,
    onAllFailed: () => void,
  ) {
    for (const url of TRACKERS) {
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        if (++this.failed === TRACKERS.length) onAllFailed();
        continue;
      }
      let opened = false;
      socket.onopen = () => {
        opened = true;
        if (!this.closed) onOpen(socket);
      };
      socket.onmessage = (e) => {
        if (this.closed || typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) return;
        try {
          onMessage(JSON.parse(e.data) as TrackerMessage, socket);
        } catch {
          // ignore malformed tracker messages
        }
      };
      const onDown = () => {
        if (!opened && !this.closed && ++this.failed === TRACKERS.length) onAllFailed();
        opened = false;
      };
      socket.onerror = onDown;
      socket.onclose = onDown;
      this.sockets.push(socket);
    }
  }

  send(socket: WebSocket, msg: object): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  each(fn: (socket: WebSocket) => void): void {
    for (const s of this.sockets) if (s.readyState === WebSocket.OPEN) fn(s);
  }

  close(): void {
    this.closed = true;
    for (const s of this.sockets) {
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      s.close();
    }
  }
}
