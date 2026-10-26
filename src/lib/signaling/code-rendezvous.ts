import { cleanPeerName, parseDeviceType, type DeviceInfo } from '../device';
import { SignalError } from '../webrtc/signal-codec';
import { pakeFinish, pakeStart, type PakeKeys } from './pake';
import { randomId, seal, TrackerPool, unseal, type TrackerMessage } from './tracker';

export { TRACKERS } from './tracker';

/**
 * Pairing with a 6-digit code, without a server of our own.
 *
 * Public WebTorrent trackers already relay WebRTC offers/answers between
 * browsers that announce the same 20-character "info hash"; we use those
 * messages as a mailbox and run a PAKE (lib/signaling/pake) through it:
 *
 *   joiner                                    host (made the code)
 *   M1 hello {sid, Ya}            ──offer──▶
 *                                 ◀─answer──  M2 {Yb}
 *   M3 proof {tag, seal(offer, name)} ─▶      checks the tag; wrong → counts a failed try
 *                                             asks its user: "<name> wants to connect"
 *                                 ◀─answer──  M4 result {tag, seal(answer)} | {ok: false, reason}
 *
 * Only the first digit picks the room (one of 10 info hashes). A room
 * derived from the whole code would give the code away: anyone watching the
 * tracker could try all 10^6 codes against the info hash. So 5 digits never
 * leave the device, and from a recording nothing about them can be checked.
 * An attacker taking part gets one guess per run (1 in 100 000); the host
 * closes the room after MAX_FAILED wrong tries.
 *
 * The connection codes (SDP, with the DTLS fingerprints) travel sealed with
 * the PAKE key, so a connection made this way is verified: whoever is on the
 * other end knows the code (hooks/useSession).
 *
 * Several trackers are used in parallel; the first one that works wins.
 * Other theShare users with a code that starts with the same digit share the
 * room: their messages fail the key confirmation and are told apart that way
 * (at the cost of a failed try, which is why a few are allowed).
 */

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60_000;
/** Wrong-code tries a host allows before closing the room. */
export const MAX_FAILED = 3;
const PROTOCOL = 'theshare-code/2';
const ROOM_LABEL = 'theshare/code-room/v2';
const JOIN_TIMEOUT_MS = 20_000;
/** Once the host has our proof, its user has to accept the request. */
const APPROVAL_TIMEOUT_MS = 90_000;
const HOST_ANNOUNCE_MS = 20_000;
const JOIN_ANNOUNCE_MS = 3_000;
/** Each offer copy reaches one random swarm member; a few copies reach the host among others in the room. */
const OFFER_COPIES = 5;
/** Runs one side keeps open at once: bounds the work strangers in the room can cause. */
const MAX_RUNS = 8;
/** Hosts a joiner sends its proof to (each could be an attacker making one guess). */
const MAX_HOSTS = 3;
/**
 * Every host that answered so far had another code: rooms are shared, and ours
 * may not have seen us yet. Keep looking this long before saying "wrong code".
 */
const WRONG_CODE_GRACE_MS = 4_000;

const MSG_UNREACHABLE =
  'Eşleştirme sunucularına ulaşılamadı. İnternet bağlantınızı kontrol edin ya da QR ile bağlanın.';
const MSG_NOT_FOUND = 'Bu kodla bekleyen bir cihaz bulunamadı. Kodu kontrol edin; kodun süresi dolmuş olabilir.';
const MSG_WRONG = 'Kod yanlış. Diğer cihazdaki kodu kontrol edip tekrar girin.';
const MSG_DECLINED = 'Karşı cihaz bağlantıyı kabul etmedi.';
const MSG_NO_ANSWER = 'Karşı cihaz isteği zamanında onaylamadı. Tekrar deneyin.';
const MSG_BUSY = 'Karşı cihaz şu anda başka bir bağlantı isteğini yanıtlıyor. Biraz sonra tekrar deneyin.';
const MSG_LOCKED = 'Bu kod çok kez yanlış denendi ve kapatıldı. Diğer cihazdan yeni bir kod isteyin.';

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

/** The room (info hash) for a code: from its first digit only, see above. */
export async function codeRoom(code: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ROOM_LABEL}|${code.slice(0, 1)}`)));
  return [...digest.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The joiner's display identity, sealed inside its proof so the host can ask its user. */
export type Requester = Pick<DeviceInfo, 'name' | 'kind' | 'os'>;

type Wire =
  | { t: 'hello'; p: typeof PROTOCOL; sid: string; y: string }
  | { t: 'share'; y: string }
  | { t: 'proof'; tag: string; box: string }
  | { t: 'result'; ok: true; tag: string; box: string }
  | { t: 'result'; ok: false; reason: 'wrong' | 'declined' | 'busy' | 'locked' };

function parseWire(data: unknown): Wire | null {
  if (typeof data !== 'string' || data.length > 64 * 1024) return null;
  try {
    const m = JSON.parse(data) as Record<string, unknown>;
    const str = (v: unknown, max = 64 * 1024): v is string => typeof v === 'string' && v.length <= max;
    switch (m.t) {
      case 'hello':
        return m.p === PROTOCOL && str(m.sid, 64) && str(m.y, 64) ? { t: 'hello', p: PROTOCOL, sid: m.sid, y: m.y } : null;
      case 'share':
        return str(m.y, 64) ? { t: 'share', y: m.y } : null;
      case 'proof':
        return str(m.tag, 64) && str(m.box) ? { t: 'proof', tag: m.tag, box: m.box } : null;
      case 'result':
        if (m.ok === true) return str(m.tag, 64) && str(m.box) ? { t: 'result', ok: true, tag: m.tag, box: m.box } : null;
        return m.reason === 'wrong' || m.reason === 'declined' || m.reason === 'busy' || m.reason === 'locked'
          ? { t: 'result', ok: false, reason: m.reason }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const isPeerId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

export interface HostHandlers {
  /** Someone proved they know the code. Resolve true to connect (the user's answer). */
  onRequest: (from: Requester) => Promise<boolean>;
  /** Called with the joiner's connection code; returns our answer code. */
  onOffer: (offer: string) => Promise<string>;
  /** A wrong code was tried (count so far, < MAX_FAILED). */
  onFailedTry: (count: number) => void;
  /** MAX_FAILED wrong tries: the room is closed. */
  onLocked: () => void;
  onError: (message: string) => void;
}

/** Code creator: waits in the room for a joiner that knows the code. Returns stop(). */
export function hostWithCode(code: string, handlers: HostHandlers): () => void {
  const peerId = randomId();
  const runs = new Map<string, { offerId: string; keys: Promise<PakeKeys | null>; done: boolean }>();
  let pool: TrackerPool | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let failures = 0;
  let busy = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
    pool?.close();
  };

  void codeRoom(code).then((infoHash) => {
    if (stopped) return;
    const announce = (socket: WebSocket) =>
      pool!.send(socket, { action: 'announce', info_hash: infoHash, peer_id: peerId, numwant: 0, uploaded: 0, downloaded: 0, event: 'started', offers: [] });
    const reply = (socket: WebSocket, to: string, offerId: string, body: Wire) =>
      pool!.send(socket, { action: 'announce', info_hash: infoHash, peer_id: peerId, to_peer_id: to, offer_id: offerId, answer: { type: 'answer', sdp: JSON.stringify(body) } });

    const onMessage = async (msg: TrackerMessage, socket: WebSocket) => {
      const from = msg.peer_id;
      const offerId = msg.offer_id;
      if (stopped || msg.info_hash !== infoHash || !isPeerId(from) || from === peerId || !isPeerId(offerId)) return;

      // M1: start a run. Copies of the same hello arrive through every tracker; the first one counts.
      if (msg.offer) {
        const hello = parseWire(msg.offer.sdp);
        if (hello?.t !== 'hello' || runs.has(from) || runs.size >= MAX_RUNS) return;
        const side = pakeStart(code, PROTOCOL, hello.sid, 'responder');
        runs.set(from, { offerId, keys: pakeFinish(side, hello.y), done: false });
        reply(socket, from, offerId, { t: 'share', y: side.share });
        return;
      }

      // M3: their proof and sealed offer.
      const proof = parseWire(msg.answer?.sdp);
      const run = runs.get(from);
      if (proof?.t !== 'proof' || !run || run.done || run.offerId !== offerId) return;
      run.done = true;
      const keys = await run.keys;
      if (stopped) return;
      if (!keys || !(await keys.check(proof.tag))) {
        failures++;
        const locked = failures >= MAX_FAILED;
        reply(socket, from, offerId, { t: 'result', ok: false, reason: locked ? 'locked' : 'wrong' });
        if (locked) {
          stop();
          handlers.onLocked();
        } else {
          handlers.onFailedTry(failures);
        }
        return;
      }
      const inner = await unseal(keys.key, proof.box);
      const payload = parseInner(inner);
      if (!payload || stopped) return;
      if (busy) return reply(socket, from, offerId, { t: 'result', ok: false, reason: 'busy' });
      busy = true; // one request at a time; claimed before awaiting the user
      try {
        if (!(await handlers.onRequest(payload.from))) {
          if (!stopped) reply(socket, from, offerId, { t: 'result', ok: false, reason: 'declined' });
          busy = false;
          return;
        }
        if (stopped) return;
        const answer = await handlers.onOffer(payload.offer);
        if (stopped) return;
        reply(socket, from, offerId, { t: 'result', ok: true, tag: keys.tag, box: await seal(keys.key, answer) });
      } catch {
        busy = false; // that offer was unusable; keep waiting for another
      }
    };

    pool = new TrackerPool(announce, (msg, socket) => void onMessage(msg, socket), () => handlers.onError(MSG_UNREACHABLE));
    timer = setInterval(() => pool?.each(announce), HOST_ANNOUNCE_MS);
  });

  return stop;
}

function parseInner(text: string | null): { offer: string; from: Requester } | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    if (typeof m.offer !== 'string') return null;
    return { offer: m.offer, from: { name: cleanPeerName(m.name) || 'Bilinmeyen cihaz', ...parseDeviceType(m.kind, m.os) } };
  } catch {
    return null;
  }
}

export interface JoinOptions {
  /** Our proof reached the host; its user is being asked. */
  onWaitingApproval?: () => void;
}

/** Code enterer: proves it knows the code, sends our offer and resolves with the host's answer. */
export async function joinWithCode(code: string, offer: string, me: Requester, { onWaitingApproval }: JoinOptions = {}): Promise<string> {
  const infoHash = await codeRoom(code);
  const peerId = randomId();
  const side = pakeStart(code, PROTOCOL, randomId() + randomId(), 'initiator');
  const hello = JSON.stringify({ t: 'hello', p: PROTOCOL, sid: side.sid, y: side.share } satisfies Wire);
  const offers = Array.from({ length: OFFER_COPIES }, () => ({ offer: { type: 'offer', sdp: hello }, offer_id: randomId() }));
  const offerIds = new Set(offers.map((o) => o.offer_id));
  const box = (keys: PakeKeys) => seal(keys.key, JSON.stringify({ offer, ...me }));
  /** Hosts we sent a proof to; 'failed' once they turned it down or proved nothing. */
  const hosts = new Map<string, { keys: PakeKeys | null; state: 'pending' | 'sent' | 'failed' }>();

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastFailure = MSG_NOT_FOUND;
    let timeout = setTimeout(() => finish(() => reject(new SignalError(lastFailure))), JOIN_TIMEOUT_MS);
    // A host passed M2 and has our proof: from here on we're waiting for a person.
    const waitForApproval = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => finish(() => reject(new SignalError(MSG_NO_ANSWER))), APPROVAL_TIMEOUT_MS);
      onWaitingApproval?.();
    };
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
    /** `final`: the host knew our code and said no; any other failure may just be someone else's room. */
    const failHost = (host: { state: string }, message: string, final = false) => {
      host.state = 'failed';
      lastFailure = message;
      if (![...hosts.values()].every((h) => h.state === 'failed')) return;
      if (final) return finish(() => reject(new SignalError(message)));
      clearTimeout(timeout);
      timeout = setTimeout(() => finish(() => reject(new SignalError(lastFailure))), WRONG_CODE_GRACE_MS);
      pool.each(announce);
    };

    const onMessage = async (msg: TrackerMessage, socket: WebSocket) => {
      const from = msg.peer_id;
      const offerId = msg.offer_id;
      if (settled || msg.info_hash !== infoHash || !isPeerId(from) || !isPeerId(offerId) || !offerIds.has(offerId)) return;
      const body = parseWire(msg.answer?.sdp);
      if (!body) return;

      if (body.t === 'share') {
        if (hosts.has(from) || hosts.size >= MAX_HOSTS) return;
        const host: { keys: PakeKeys | null; state: 'pending' | 'sent' | 'failed' } = { keys: null, state: 'pending' };
        hosts.set(from, host);
        host.keys = await pakeFinish(side, body.y);
        if (!host.keys) return failHost(host, MSG_WRONG);
        const proof: Wire = { t: 'proof', tag: host.keys.tag, box: await box(host.keys) };
        if (settled) return;
        pool.send(socket, { action: 'announce', info_hash: infoHash, peer_id: peerId, to_peer_id: from, offer_id: offerId, answer: { type: 'answer', sdp: JSON.stringify(proof) } });
        host.state = 'sent';
        waitForApproval();
        return;
      }

      const host = hosts.get(from);
      if (body.t !== 'result' || host?.state !== 'sent' || !host.keys) return;
      if (!body.ok) {
        if (body.reason === 'declined' || body.reason === 'busy') return failHost(host, body.reason === 'declined' ? MSG_DECLINED : MSG_BUSY, true);
        return failHost(host, body.reason === 'locked' ? MSG_LOCKED : MSG_WRONG);
      }
      // Anyone can claim "ok"; only the real host can confirm the key and seal the answer.
      const answer = (await host.keys.check(body.tag)) ? await unseal(host.keys.key, body.box) : null;
      if (answer) finish(() => resolve(answer));
      else failHost(host, MSG_WRONG);
    };

    const pool = new TrackerPool(announce, (msg, socket) => void onMessage(msg, socket), () => finish(() => reject(new SignalError(MSG_UNREACHABLE))));
    // The host may not have announced yet on every tracker; keep re-sending.
    const timer = setInterval(() => {
      if (![...hosts.values()].some((h) => h.state === 'sent')) pool.each(announce);
    }, JOIN_ANNOUNCE_MS);
  });
}
