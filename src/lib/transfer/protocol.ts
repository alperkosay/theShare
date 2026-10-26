/**
 * Wire protocol over the single ordered, reliable data channel.
 *
 * - Control messages are JSON strings (validated on receipt).
 * - File bytes are binary messages. Because the channel is ordered and each
 *   side has at most one outgoing transfer at a time, a binary message always
 *   belongs to the file announced by the peer's latest `file-start`.
 *
 *   sender                         receiver
 *   offer {id, files}      ──▶
 *                          ◀──     accept {id} | reject {id}
 *   file-start {id, index} ──▶
 *   <binary chunks>        ──▶
 *                          ◀──     ack {id, bytes}   (cumulative, after writing)
 *   file-end {id, index}   ──▶
 *   …next file…
 *                          ◀──     complete {id}
 *   cancel {id} may be sent by either side at any time.
 *
 * Screen sharing (lib/webrtc/media) adds media tracks to the same connection;
 * the renegotiation that needs (sdp, ice) and the share's state (screen,
 * screen-ask, screen-no) travel as control messages too.
 */

import { cleanPeerName, parseDeviceType, type DeviceKind, type DeviceOs } from '../device';

export const PROTOCOL_VERSION = 1;
export const MAX_FILES_PER_TRANSFER = 500;
const MAX_CONTROL_LENGTH = 512 * 1024;
const MAX_NAME_LENGTH = 255;

export interface FileMeta {
  name: string;
  size: number;
  /** Sender-declared MIME type. Informational only — never used for security decisions. */
  type: string;
}

/** Text/clipboard messages: generous, but bounded so a peer can't flood memory. */
export const MAX_TEXT_LENGTH = 100_000;
/** Renegotiation SDP with audio + video sections is a few KB; this leaves plenty of room. */
const MAX_MEDIA_SDP_LENGTH = 64 * 1024;
const MAX_CANDIDATE_LENGTH = 1024;

export type ControlMessage =
  /** Sent once on connect: display identity plus a persistent random device id (see lib/device). */
  | { t: 'hello'; v: number; name?: string; kind?: DeviceKind; os?: DeviceOs; id?: string }
  | { t: 'text'; id: string; text: string }
  | { t: 'offer'; id: string; files: FileMeta[] }
  | { t: 'accept'; id: string }
  | { t: 'reject'; id: string; reason?: string }
  | { t: 'file-start'; id: string; index: number }
  | { t: 'file-end'; id: string; index: number }
  | { t: 'ack'; id: string; bytes: number }
  | { t: 'complete'; id: string }
  | { t: 'cancel'; id: string; reason?: string }
  | { t: 'bye' }
  | MediaMessage;

export type MediaMessage =
  /** Renegotiation of this connection when screen-share tracks are added or removed. */
  | { t: 'sdp'; type: 'offer' | 'answer'; sdp: string }
  | { t: 'ice'; candidate: string; mid: string | null; index: number | null }
  /** The sender started (`on`) or stopped sharing its screen; `audio` when it includes sound. */
  | { t: 'screen'; on: boolean; audio?: boolean }
  /** The viewer asks to see the other side's screen… */
  | { t: 'screen-ask' }
  /** …and the answer when it won't come: declined, or this browser can't capture its screen. */
  | { t: 'screen-no'; unsupported?: boolean };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isReason = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= 500);

function parseFileMeta(v: unknown): FileMeta | null {
  if (typeof v !== 'object' || v === null) return null;
  const { name, size, type } = v as Record<string, unknown>;
  if (typeof name !== 'string' || name.length > 4 * MAX_NAME_LENGTH || !isCount(size)) return null;
  return {
    name: sanitizeFileName(name),
    size,
    type: typeof type === 'string' && type.length <= 255 ? type : '',
  };
}

/** Parses and validates an incoming control message; returns null if it is malformed. */
export function parseControl(text: string): ControlMessage | null {
  if (text.length > MAX_CONTROL_LENGTH) return null;
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.t) {
    case 'hello': {
      if (!isCount(m.v)) return null;
      const name = cleanPeerName(m.name);
      return {
        t: 'hello',
        v: m.v,
        ...(name ? { name, ...parseDeviceType(m.kind, m.os) } : {}),
        ...(isId(m.id) ? { id: m.id } : {}),
      };
    }
    case 'text':
      return isId(m.id) && typeof m.text === 'string' && m.text.length > 0 && m.text.length <= MAX_TEXT_LENGTH
        ? { t: 'text', id: m.id, text: m.text }
        : null;
    case 'offer': {
      if (!isId(m.id) || !Array.isArray(m.files)) return null;
      if (m.files.length === 0 || m.files.length > MAX_FILES_PER_TRANSFER) return null;
      const files = m.files.map(parseFileMeta);
      if (files.some((f) => f === null)) return null;
      return { t: 'offer', id: m.id, files: files as FileMeta[] };
    }
    case 'accept':
    case 'complete':
      return isId(m.id) ? { t: m.t, id: m.id } : null;
    case 'reject':
    case 'cancel':
      return isId(m.id) && isReason(m.reason)
        ? { t: m.t, id: m.id, ...(m.reason ? { reason: m.reason as string } : {}) }
        : null;
    case 'file-start':
    case 'file-end':
      return isId(m.id) && isCount(m.index) ? { t: m.t, id: m.id, index: m.index } : null;
    case 'ack':
      return isId(m.id) && isCount(m.bytes) ? { t: 'ack', id: m.id, bytes: m.bytes } : null;
    case 'bye':
      return { t: 'bye' };
    case 'sdp':
      return (m.type === 'offer' || m.type === 'answer') && typeof m.sdp === 'string' && m.sdp.length <= MAX_MEDIA_SDP_LENGTH
        ? { t: 'sdp', type: m.type, sdp: m.sdp }
        : null;
    case 'ice': {
      const midOk = m.mid === null || (typeof m.mid === 'string' && m.mid.length <= 32);
      const indexOk = m.index === null || isCount(m.index);
      return typeof m.candidate === 'string' && m.candidate.length <= MAX_CANDIDATE_LENGTH && midOk && indexOk
        ? { t: 'ice', candidate: m.candidate, mid: m.mid as string | null, index: m.index as number | null }
        : null;
    }
    case 'screen':
      return typeof m.on === 'boolean' ? { t: 'screen', on: m.on, ...(m.on && m.audio === true ? { audio: true } : {}) } : null;
    case 'screen-ask':
      return { t: 'screen-ask' };
    case 'screen-no':
      return { t: 'screen-no', ...(m.unsupported === true ? { unsupported: true } : {}) };
    default:
      return null;
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Makes a peer-supplied file name safe to use as a download/save name:
 * no path separators, control characters or reserved names, bounded length.
 */
export function sanitizeFileName(raw: string): string {
  let name = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME_LENGTH) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }
  return name || 'dosya';
}

export function newTransferId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}
