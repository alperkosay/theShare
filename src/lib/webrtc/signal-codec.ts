/**
 * Signaling payload codec.
 *
 * A complete (non-trickle) SDP for a data-channel-only connection is 1.5–3 KB,
 * which makes a dense, hard-to-scan QR code. But only a handful of fields in it
 * actually matter, so we transmit just those and rebuild an equivalent SDP on
 * the other side:
 *
 *   TS1.<base64url>  compact binary form: ICE ufrag/pwd, DTLS sha-256
 *                    fingerprint, DTLS role, max-message-size, UDP candidates.
 *                    Typically 120–250 characters.
 *   TSZ.<base64url>  fallback for SDPs the compact form can't express:
 *                    deflate-raw compressed JSON { t: type, s: sdp }.
 *
 * Everything decoded from the outside is treated as untrusted: sizes are
 * bounded, the binary form is bounds-checked and the resulting SDP is
 * validated to contain exactly one data channel m-line and nothing else.
 */

export type SignalKind = 'offer' | 'answer';

export interface SessionDescription {
  type: SignalKind;
  sdp: string;
}

/** User-facing error (message is shown in the UI as-is). */
export class SignalError extends Error {
  override name = 'SignalError';
}

/** Internal: the SDP has something the compact form can't represent. */
class CompactUnsupported extends Error {}

export const MAX_SIGNAL_TEXT_LENGTH = 16 * 1024;
export const MAX_SDP_LENGTH = 32 * 1024;
const MAX_CANDIDATES = 16;
const COMPACT_VERSION = 1;
const PREFIX_COMPACT = 'TS1.';
const PREFIX_DEFLATE = 'TSZ.';
/** URL fragment key used in the offer link: https://host/app/#s=TS1.xxxx */
export const SIGNAL_HASH_KEY = 's';

type Setup = 'actpass' | 'active' | 'passive';
const SETUPS: readonly Setup[] = ['actpass', 'active', 'passive'];
type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay';
const CANDIDATE_TYPES: readonly CandidateType[] = ['host', 'srflx', 'prflx', 'relay'];
const TYPE_PREFERENCE: Record<CandidateType, number> = { host: 126, prflx: 110, srflx: 100, relay: 0 };

const ADDR_IPV4 = 0;
const ADDR_MDNS = 1;
const ADDR_TEXT = 2;
// Unknown/absent max-message-size; per RFC 8841 absence means 64 KiB.
const MMS_ABSENT = 0xffffffff;

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const MDNS_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i;
const ADDRESS_TEXT_RE = /^[0-9A-Za-z.:-]{1,64}$/;
const ICE_CHAR_RE = /^[A-Za-z0-9+/]+$/;

export interface Candidate {
  address: string;
  port: number;
  type: CandidateType;
}

export interface CompactSignal {
  kind: SignalKind;
  setup: Setup;
  ufrag: string;
  pwd: string;
  /** 32-byte sha-256 DTLS certificate fingerprint. */
  fingerprint: Uint8Array;
  maxMessageSize: number | null;
  candidates: Candidate[];
}

// ---------------------------------------------------------------------------
// SDP parsing / building
// ---------------------------------------------------------------------------

function sdpLines(sdp: string): string[] {
  return sdp.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** Parses a `a=candidate:` line (without the `a=` prefix). Returns null for candidates we skip. */
export function parseCandidate(line: string): Candidate | null {
  const body = line.replace(/^a=/, '').replace(/^candidate:/, '');
  const parts = body.split(/\s+/);
  // foundation component transport priority address port "typ" type ...
  if (parts.length < 8 || parts[6] !== 'typ') return null;
  const [, component, transport, , address, portText, , type] = parts as [
    string, string, string, string, string, string, string, string,
  ];
  if (component !== '1' || transport.toLowerCase() !== 'udp') return null;
  if (!CANDIDATE_TYPES.includes(type as CandidateType)) return null;
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!IPV4_RE.test(address) && !MDNS_RE.test(address) && !ADDRESS_TEXT_RE.test(address)) return null;
  return { address, port, type: type as CandidateType };
}

/** Extracts the compactable fields from a browser-generated SDP. Throws CompactUnsupported. */
export function sdpToCompact(desc: SessionDescription): CompactSignal {
  const lines = sdpLines(desc.sdp);
  const single = (prefix: string): string | null => {
    const values = new Set(lines.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim()));
    if (values.size > 1) throw new CompactUnsupported(`multiple ${prefix}`);
    return values.size ? [...values][0]! : null;
  };

  const mLines = lines.filter((l) => l.startsWith('m='));
  if (mLines.length !== 1 || !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(mLines[0]!)) {
    throw new CompactUnsupported('unexpected media section');
  }
  if (single('a=mid:') !== '0') throw new CompactUnsupported('mid');
  const sctpPort = single('a=sctp-port:');
  if (sctpPort !== null && sctpPort !== '5000') throw new CompactUnsupported('sctp-port');

  const ufrag = single('a=ice-ufrag:');
  const pwd = single('a=ice-pwd:');
  if (!ufrag || !pwd || ufrag.length > 255 || pwd.length > 255) throw new CompactUnsupported('ice credentials');
  if (!ICE_CHAR_RE.test(ufrag) || !ICE_CHAR_RE.test(pwd)) throw new CompactUnsupported('ice charset');

  const fp = single('a=fingerprint:');
  const fpMatch = fp?.match(/^sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})$/);
  if (!fpMatch) throw new CompactUnsupported('fingerprint');
  const fingerprint = Uint8Array.from(fpMatch[1]!.split(':').map((h) => parseInt(h, 16)));

  const setup = single('a=setup:') as Setup | null;
  if (!setup || !SETUPS.includes(setup)) throw new CompactUnsupported('setup');

  const mmsText = single('a=max-message-size:');
  let maxMessageSize: number | null = null;
  if (mmsText !== null) {
    maxMessageSize = Number(mmsText);
    if (!Number.isInteger(maxMessageSize) || maxMessageSize < 0 || maxMessageSize >= MMS_ABSENT) {
      throw new CompactUnsupported('max-message-size');
    }
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) continue;
    const c = parseCandidate(line);
    if (!c) continue;
    const key = `${c.address}:${c.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
  }
  if (candidates.length > MAX_CANDIDATES) candidates.length = MAX_CANDIDATES;
  // Only TCP / unusual candidates: keep them by falling back to the full SDP.
  if (candidates.length === 0 && lines.some((l) => l.startsWith('a=candidate:'))) {
    throw new CompactUnsupported('no compactable candidates');
  }

  return { kind: desc.type, setup, ufrag, pwd, fingerprint, maxMessageSize, candidates };
}

function fingerprintHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** Rebuilds a minimal, standards-compliant data-channel SDP from the compact fields. */
export function compactToSdp(sig: CompactSignal): string {
  // Deterministic numeric session id derived from the fingerprint (must be < 2^63).
  let sessionId = 0;
  for (let i = 0; i < 6; i++) sessionId = sessionId * 256 + sig.fingerprint[i]!;

  const lines = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  sig.candidates.forEach((c, i) => {
    const priority = TYPE_PREFERENCE[c.type] * 2 ** 24 + (65535 - i) * 256 + 255;
    const related = c.type === 'host' ? '' : ' raddr 0.0.0.0 rport 0';
    lines.push(`a=candidate:${i + 1} 1 udp ${priority} ${c.address} ${c.port} typ ${c.type}${related} generation 0`);
  });
  lines.push(
    `a=ice-ufrag:${sig.ufrag}`,
    `a=ice-pwd:${sig.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprintHex(sig.fingerprint)}`,
    `a=setup:${sig.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
  );
  if (sig.maxMessageSize !== null) lines.push(`a=max-message-size:${sig.maxMessageSize}`);
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Binary packing
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function packCompact(sig: CompactSignal): Uint8Array {
  const out: number[] = [];
  const str = (s: string) => {
    const bytes = textEncoder.encode(s);
    if (bytes.length > 255) throw new CompactUnsupported('string too long');
    out.push(bytes.length, ...bytes);
  };
  out.push(COMPACT_VERSION);
  out.push((sig.kind === 'answer' ? 1 : 0) | (SETUPS.indexOf(sig.setup) << 1));
  str(sig.ufrag);
  str(sig.pwd);
  out.push(...sig.fingerprint);
  const mms = sig.maxMessageSize ?? MMS_ABSENT;
  out.push((mms >>> 24) & 0xff, (mms >>> 16) & 0xff, (mms >>> 8) & 0xff, mms & 0xff);
  out.push(sig.candidates.length);
  for (const c of sig.candidates) {
    const typeBits = CANDIDATE_TYPES.indexOf(c.type) << 2;
    if (IPV4_RE.test(c.address)) {
      out.push(ADDR_IPV4 | typeBits, ...c.address.split('.').map(Number));
    } else if (MDNS_RE.test(c.address)) {
      const hex = c.address.slice(0, 36).replace(/-/g, '');
      out.push(ADDR_MDNS | typeBits);
      for (let i = 0; i < 32; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    } else {
      out.push(ADDR_TEXT | typeBits);
      str(c.address);
    }
    out.push((c.port >>> 8) & 0xff, c.port & 0xff);
  }
  return Uint8Array.from(out);
}

export function unpackCompact(bytes: Uint8Array): CompactSignal {
  let pos = 0;
  const fail = (): never => {
    throw new SignalError('Bağlantı kodu bozuk veya eksik. Kodu yeniden kopyalayın ya da QR kodu tekrar okutun.');
  };
  const u8 = () => (pos < bytes.length ? bytes[pos++]! : fail());
  const take = (n: number) => {
    if (pos + n > bytes.length) fail();
    const slice = bytes.subarray(pos, pos + n);
    pos += n;
    return slice;
  };
  const str = () => {
    try {
      return textDecoder.decode(take(u8()));
    } catch {
      return fail();
    }
  };

  if (u8() !== COMPACT_VERSION) {
    throw new SignalError('Bu bağlantı kodu theShare\'in farklı bir sürümüyle oluşturulmuş. İki cihazda da sayfayı yenileyin.');
  }
  const flags = u8();
  const setup = SETUPS[(flags >> 1) & 0b11] ?? fail();
  const ufrag = str();
  const pwd = str();
  if (!ICE_CHAR_RE.test(ufrag) || !ICE_CHAR_RE.test(pwd)) fail();
  const fingerprint = Uint8Array.from(take(32));
  const m = take(4);
  const mms = ((m[0]! << 24) >>> 0) + (m[1]! << 16) + (m[2]! << 8) + m[3]!;
  const count = u8();
  if (count > MAX_CANDIDATES) fail();
  const candidates: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const meta = u8();
    const type = CANDIDATE_TYPES[(meta >> 2) & 0b11]!;
    let address: string;
    switch (meta & 0b11) {
      case ADDR_IPV4:
        address = [...take(4)].join('.');
        break;
      case ADDR_MDNS: {
        const hex = [...take(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
        address = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
        break;
      }
      case ADDR_TEXT:
        address = str();
        if (!ADDRESS_TEXT_RE.test(address)) fail();
        break;
      default:
        return fail();
    }
    const p = take(2);
    const port = (p[0]! << 8) + p[1]!;
    if (port === 0) fail();
    candidates.push({ address, port, type });
  }
  if (pos !== bytes.length) fail();
  return {
    kind: flags & 1 ? 'answer' : 'offer',
    setup,
    ufrag,
    pwd,
    fingerprint,
    maxMessageSize: mms === MMS_ABSENT ? null : mms,
    candidates,
  };
}

// ---------------------------------------------------------------------------
// base64url + deflate helpers
// ---------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SignalError('Bağlantı kodunda geçersiz karakterler var.');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    throw new SignalError('Bağlantı kodu çözülemedi.');
  }
}

async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new SignalError('Bağlantı kodu izin verilen boyutu aşıyor.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return readLimited(stream, MAX_SIGNAL_TEXT_LENGTH * 4);
}

async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await readLimited(stream, limit);
  } catch (e) {
    if (e instanceof SignalError) throw e;
    throw new SignalError('Bağlantı kodu bozuk (sıkıştırılmış veri açılamadı).');
  }
}

// ---------------------------------------------------------------------------
// Validation + public API
// ---------------------------------------------------------------------------

/** Rejects anything that isn't a plain data-channel-only SDP of reasonable size. */
export function validateSdp(sdp: string): void {
  const invalid = (detail: string) => new SignalError(`Geçersiz bağlantı bilgisi: ${detail}.`);
  if (typeof sdp !== 'string' || sdp.length === 0) throw invalid('boş');
  if (sdp.length > MAX_SDP_LENGTH) throw invalid('çok büyük');
  const lines = sdpLines(sdp);
  if (lines[0] !== 'v=0') throw invalid('SDP biçiminde değil');
  if (lines.some((l) => !/^[a-z]=/.test(l))) throw invalid('tanınmayan satırlar içeriyor');
  const mLines = lines.filter((l) => l.startsWith('m='));
  if (mLines.length !== 1 || !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(mLines[0]!)) {
    throw invalid('yalnızca veri kanalı içermeli');
  }
  for (const attr of ['a=ice-ufrag:', 'a=ice-pwd:', 'a=fingerprint:']) {
    if (!lines.some((l) => l.startsWith(attr))) throw invalid(`${attr.slice(2, -1)} eksik`);
  }
}

/** Encodes a local description as a short text payload (TS1.… or TSZ.…). */
export async function encodeSignal(desc: SessionDescription): Promise<string> {
  validateSdp(desc.sdp);
  try {
    return PREFIX_COMPACT + toBase64Url(packCompact(sdpToCompact(desc)));
  } catch (e) {
    if (!(e instanceof CompactUnsupported)) throw e;
  }
  const json = textEncoder.encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  return PREFIX_DEFLATE + toBase64Url(await deflate(json));
}

/** Pulls the payload out of whatever the user pasted or scanned: a link, a fragment or the bare code. */
export function extractPayload(input: string): string {
  const text = input.replace(/\s+/g, '');
  const hashIndex = text.indexOf('#');
  if (hashIndex === -1) return text;
  const params = new URLSearchParams(text.slice(hashIndex + 1));
  return params.get(SIGNAL_HASH_KEY) ?? '';
}

/**
 * Decodes and validates a pasted/scanned payload.
 * @param expected the kind the current step needs; a mismatch gets a helpful error.
 */
export async function decodeSignal(input: string, expected: SignalKind): Promise<SessionDescription> {
  if (input.length > MAX_SIGNAL_TEXT_LENGTH) throw new SignalError('Bağlantı kodu çok uzun.');
  const payload = extractPayload(input);
  if (!payload) throw new SignalError('Bağlantı kodu boş.');

  let desc: SessionDescription;
  if (payload.startsWith(PREFIX_COMPACT)) {
    const sig = unpackCompact(fromBase64Url(payload.slice(PREFIX_COMPACT.length)));
    desc = { type: sig.kind, sdp: compactToSdp(sig) };
  } else if (payload.startsWith(PREFIX_DEFLATE)) {
    const raw = await inflate(fromBase64Url(payload.slice(PREFIX_DEFLATE.length)), MAX_SDP_LENGTH + 256);
    let parsed: unknown;
    try {
      parsed = JSON.parse(textDecoder.decode(raw));
    } catch {
      throw new SignalError('Bağlantı kodu bozuk.');
    }
    const obj = parsed as { t?: unknown; s?: unknown };
    if ((obj.t !== 'offer' && obj.t !== 'answer') || typeof obj.s !== 'string') {
      throw new SignalError('Bağlantı kodu bozuk.');
    }
    desc = { type: obj.t, sdp: obj.s };
  } else {
    throw new SignalError('Bu bir theShare bağlantı kodu değil.');
  }

  validateSdp(desc.sdp);
  if (desc.type !== expected) {
    throw new SignalError(
      expected === 'answer'
        ? 'Bu bir yanıt kodu değil, karşı tarafın davet kodu. Karşı cihazda gösterilen YANIT kodunu okutun.'
        : 'Bu bir davet kodu değil, bir yanıt kodu. Karşı cihazda gösterilen DAVET kodunu okutun.',
    );
  }
  return desc;
}

/** Builds the link placed in the offer QR: opening it on the other device starts joining. */
export function buildOfferLink(appUrl: string, payload: string): string {
  return `${appUrl.split('#')[0]}#${SIGNAL_HASH_KEY}=${payload}`;
}

/** Returns the sha-256 DTLS fingerprint hex string of an SDP, if present. */
export function sdpFingerprint(sdp: string): string | null {
  return sdp.match(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/)?.[1]?.toUpperCase() ?? null;
}

/** All candidates (for the diagnostics panel). */
export function sdpCandidates(sdp: string): Candidate[] {
  return sdpLines(sdp)
    .filter((l) => l.startsWith('a=candidate:'))
    .map(parseCandidate)
    .filter((c): c is Candidate => c !== null);
}
