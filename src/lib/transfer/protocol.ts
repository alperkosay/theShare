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
 */

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

export type ControlMessage =
  | { t: 'hello'; v: number }
  | { t: 'offer'; id: string; files: FileMeta[] }
  | { t: 'accept'; id: string }
  | { t: 'reject'; id: string; reason?: string }
  | { t: 'file-start'; id: string; index: number }
  | { t: 'file-end'; id: string; index: number }
  | { t: 'ack'; id: string; bytes: number }
  | { t: 'complete'; id: string }
  | { t: 'cancel'; id: string; reason?: string }
  | { t: 'bye' };

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
    case 'hello':
      return isCount(m.v) ? { t: 'hello', v: m.v } : null;
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
