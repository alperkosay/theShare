import { SignalError } from '../webrtc/signal-codec';
import { deriveRoom, randomId, seal, TrackerPool, unseal } from './tracker';

export { TRACKERS } from './tracker';

/**
 * Pairing with a 6-digit code, without a server of our own.
 *
 * Public WebTorrent trackers already relay WebRTC offers/answers between
 * browsers that announce the same 20-character "info hash". We derive that
 * hash from the code, so two devices that know the code meet there and swap
 * their (encrypted) connection codes. Files never touch the trackers.
 *
 *   code creator ("host")                tracker                  code enterer ("joiner")
 *   announce(hash)               ──▶
 *                                          ◀── announce(hash, offers=[enc(offer)])
 *                                ◀── offer
 *   announce(to=joiner, answer=enc(answer)) ──▶
 *                                               answer ──▶
 *
 * Several trackers are used in parallel; the first one that works wins.
 *
 * Security: the payload is AES-GCM encrypted with a key derived from the code
 * (PBKDF2), which keeps tracker operators and other swarm members from reading
 * IP addresses casually. A 6-digit code is NOT strong authentication — it can
 * be brute-forced. The real protection is the pairing code both screens show
 * after connecting (derived from the DTLS fingerprints) plus the receiver's
 * explicit approval of every transfer.
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
const JOIN_TIMEOUT_MS = 20_000;
const HOST_ANNOUNCE_MS = 20_000;
const JOIN_ANNOUNCE_MS = 3_000;
/** Each offer copy reaches one random swarm member; a few copies make stale peers harmless. */
const OFFER_COPIES = 3;

const MSG_UNREACHABLE =
  'Eşleştirme sunucularına ulaşılamadı. İnternet bağlantınızı kontrol edin ya da QR ile bağlanın.';

export function generateCode(): string {
  // Rejection sampling for a uniform 6-digit number.
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= 4_294_000_000);
  return String(n % 10 ** CODE_LENGTH).padStart(CODE_LENGTH, '0');
}

/** Accepts "482 913", "482-913" etc. Returns null unless exactly 6 digits. */
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

export interface HostHandlers {
  /** Called once with the joiner's connection code; returns our answer code. */
  onOffer: (offer: string) => Promise<string>;
  onError: (message: string) => void;
}

/** Code creator: waits in the swarm for an offer and answers it. Returns stop(). */
export function hostWithCode(code: string, handlers: HostHandlers): () => void {
  const peerId = randomId();
  let pool: TrackerPool | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  let stopped = false;

  void deriveRoom(code).then(({ infoHash, key }) => {
    if (stopped) return;
    const announce = (socket: WebSocket) =>
      pool!.send(socket, { action: 'announce', info_hash: infoHash, peer_id: peerId, numwant: 0, uploaded: 0, downloaded: 0, event: 'started', offers: [] });

    pool = new TrackerPool(
      announce,
      async (msg, socket) => {
        if (busy || msg.info_hash !== infoHash || !msg.offer || msg.peer_id === peerId) return;
        busy = true; // claim before awaiting so parallel copies of the offer are ignored
        const offer = await unseal(key, msg.offer.sdp);
        if (!offer || stopped) {
          busy = false;
          return;
        }
        try {
          const answer = await handlers.onOffer(offer);
          if (stopped) return;
          pool!.send(socket, {
            action: 'announce',
            info_hash: infoHash,
            peer_id: peerId,
            to_peer_id: msg.peer_id,
            offer_id: msg.offer_id,
            answer: { type: 'answer', sdp: await seal(key, answer) },
          });
        } catch {
          busy = false; // that offer was unusable; keep waiting for another
        }
      },
      () => handlers.onError(MSG_UNREACHABLE),
    );
    timer = setInterval(() => pool?.each(announce), HOST_ANNOUNCE_MS);
  });

  return () => {
    stopped = true;
    clearInterval(timer);
    pool?.close();
  };
}

/** Code enterer: publishes our offer and resolves with the host's answer. */
export async function joinWithCode(code: string, offer: string): Promise<string> {
  const { infoHash, key } = await deriveRoom(code);
  const peerId = randomId();
  const sealed = await seal(key, offer);
  const offers = Array.from({ length: OFFER_COPIES }, () => ({ offer: { type: 'offer', sdp: sealed }, offer_id: randomId() }));
  const offerIds = new Set(offers.map((o) => o.offer_id));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      pool.close();
      fn();
    };
    const announce = (socket: WebSocket) =>
      pool.send(socket, { action: 'announce', info_hash: infoHash, peer_id: peerId, numwant: OFFER_COPIES, uploaded: 0, downloaded: 0, event: 'started', offers });

    const pool = new TrackerPool(
      announce,
      async (msg) => {
        if (msg.info_hash !== infoHash || !msg.answer || !offerIds.has(msg.offer_id as string)) return;
        const answer = await unseal(key, msg.answer.sdp);
        if (answer) finish(() => resolve(answer));
      },
      () => finish(() => reject(new SignalError(MSG_UNREACHABLE))),
    );
    // The host may not have announced yet on every tracker; keep re-sending.
    const timer = setInterval(() => pool.each(announce), JOIN_ANNOUNCE_MS);
    const timeout = setTimeout(
      () => finish(() => reject(new SignalError('Bu kodla bekleyen bir cihaz bulunamadı. Kodu kontrol edin; kodun süresi dolmuş olabilir.'))),
      JOIN_TIMEOUT_MS,
    );
  });
}
