import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';

/**
 * CPace (draft-irtf-cfrg-cpace) over ristretto255: turns the 6-digit code into
 * a strong shared key without letting anyone test guesses offline.
 *
 *   g  = hash_to_ristretto255(code, channel, sid)        (RFC 9380)
 *   initiator: Ya = ya·g          responder: Yb = yb·g
 *   K  = ya·Yb = yb·Ya
 *   ISK = SHA-512(K, sid, Ya, Yb) → AES-GCM key + key-confirmation MAC key
 *
 * Someone who doesn't know the code sees only random-looking points: from a
 * recording of Ya and Yb no code can be checked. An attacker taking part in a
 * run can test exactly one guess (the one its own point was made with), and
 * the other side notices when the key confirmation fails. The structure
 * follows the draft; the byte encoding is our own (length-prefixed fields,
 * RFC 9380 hash-to-curve for the generator) and was not checked against the
 * draft's test vectors, so the two are not interoperable.
 */

export type PakeRole = 'initiator' | 'responder';

const DST = 'theshare/cpace/ristretto255/v1';
const SCALAR_DST = `${DST}/scalar`;
const ISK_LABEL = 'theshare/cpace/isk/v1';
const enc = new TextEncoder();

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const HEX_32 = /^[0-9a-f]{64}$/;

/** Length-prefixed concatenation, so no two different field lists encode the same. */
function lv(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + 2 + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out[at++] = p.length >> 8;
    out[at++] = p.length & 0xff;
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface PakeSide {
  role: PakeRole;
  sid: string;
  /** Our public share, sent to the other side (32 bytes, hex). */
  share: string;
  secret: bigint;
}

/** Starts one run. `channel` names what the key is for; both sides must use the same `sid` (fresh per run). */
export function pakeStart(password: string, channel: string, sid: string, role: PakeRole): PakeSide {
  const g = ristretto255_hasher.hashToCurve(lv(enc.encode(password), enc.encode(channel), enc.encode(sid)), { DST });
  let secret = 0n;
  while (secret === 0n) secret = ristretto255_hasher.hashToScalar(crypto.getRandomValues(new Uint8Array(64)), { DST: SCALAR_DST });
  return { role, sid, share: toHex(g.multiply(secret).toBytes()), secret };
}

export interface PakeKeys {
  /** For sealing payloads (lib/signaling/tracker seal/unseal). */
  key: CryptoKey;
  /** Our key confirmation, to send. */
  tag: string;
  /** Checks the other side's key confirmation. */
  check: (tag: unknown) => Promise<boolean>;
}

/** Finishes a run with the other side's share. Null for a share that isn't a valid, non-identity point. */
export async function pakeFinish(side: PakeSide, theirShare: unknown): Promise<PakeKeys | null> {
  if (typeof theirShare !== 'string' || !HEX_32.test(theirShare) || theirShare === side.share) return null;
  let K;
  try {
    const point = ristretto255.Point.fromHex(theirShare);
    if (point.is0()) return null;
    K = point.multiply(side.secret);
  } catch {
    return null; // not a canonical ristretto255 encoding
  }
  if (K.is0()) return null;

  const [ya, yb] = side.role === 'initiator' ? [side.share, theirShare] : [theirShare, side.share];
  const isk = new Uint8Array(
    await crypto.subtle.digest('SHA-512', lv(enc.encode(ISK_LABEL), enc.encode(side.sid), K.toBytes(), enc.encode(ya), enc.encode(yb))),
  );
  const key = await crypto.subtle.importKey('raw', isk.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const mac = await crypto.subtle.importKey('raw', isk.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const tagFor = async (role: PakeRole) => toHex(new Uint8Array(await crypto.subtle.sign('HMAC', mac, enc.encode(role))));
  const other: PakeRole = side.role === 'initiator' ? 'responder' : 'initiator';
  return {
    key,
    tag: await tagFor(side.role),
    check: async (tag) => {
      if (typeof tag !== 'string' || !HEX_32.test(tag)) return false;
      const bytes = Uint8Array.from(tag.match(/../g)!, (h) => parseInt(h, 16));
      // HMAC verify compares in constant time.
      return crypto.subtle.verify('HMAC', mac, bytes, enc.encode(other));
    },
  };
}
