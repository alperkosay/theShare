/**
 * "Zero connection" transfer: a file or text shown as a stream of QR codes
 * on one screen and read by the other device's camera. No network of any
 * kind (no Wi-Fi, no WebRTC), so it also works between devices that can't
 * or shouldn't be connected. It is slow, a few KB/s, so it's meant for
 * small files, notes, keys and the like.
 *
 * Payload: flags u8 · meta length u16 · meta JSON · body (deflate-raw'd when
 * that is smaller). The meta carries the SHA-256 of the original bytes; the
 * receiver checks it after reassembly.
 */

import { sanitizeFileName } from '../transfer/protocol';
import { FountainDecoder, blockCount, decodeFrame, type StreamHeader } from './fountain';

export const MAX_AIR_BYTES = 1024 * 1024;

export type AirPresetId = 'stable' | 'normal' | 'fast';

export interface AirPreset {
  label: string;
  /** Bytes per QR code: bigger means a denser code that needs a better camera. */
  blockSize: number;
  fps: number;
}

export const AIR_PRESETS: Record<AirPresetId, AirPreset> = {
  stable: { label: 'Kararlı', blockSize: 200, fps: 6 },
  normal: { label: 'Normal', blockSize: 400, fps: 8 },
  fast: { label: 'Hızlı', blockSize: 650, fps: 12 },
};

/** Typical time to get through, assuming some frames are missed. */
export function estimateSeconds(length: number, preset: AirPreset): number {
  return Math.ceil((blockCount({ sid: 0, length, blockSize: preset.blockSize }) * 1.25) / preset.fps);
}

export interface AirItem {
  kind: 'file' | 'text';
  /** File name; empty for text. */
  name: string;
  bytes: Uint8Array;
}

interface Meta {
  v: 1;
  k: 'file' | 'text';
  n: string;
  s: number;
  h: string;
}

const FLAG_DEFLATE = 1;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function packAir(item: AirItem): Promise<Uint8Array> {
  const meta: Meta = { v: 1, k: item.kind, n: item.name, s: item.bytes.length, h: await sha256Hex(item.bytes) };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  let body = item.bytes;
  let flags = 0;
  if (typeof CompressionStream === 'function') {
    try {
      const packed = await pipe(item.bytes, new CompressionStream('deflate-raw'));
      if (packed.length < body.length) {
        body = packed;
        flags |= FLAG_DEFLATE;
      }
    } catch {
      // send it uncompressed
    }
  }
  const out = new Uint8Array(3 + metaBytes.length + body.length);
  out[0] = flags;
  new DataView(out.buffer).setUint16(1, metaBytes.length);
  out.set(metaBytes, 3);
  out.set(body, 3 + metaBytes.length);
  return out;
}

export class AirError extends Error {
  override name = 'AirError';
}

export async function unpackAir(data: Uint8Array): Promise<AirItem> {
  const fail = (message = 'Gelen veri bozuk. Baştan tekrar deneyin.') => new AirError(message);
  if (data.length < 3) throw fail();
  const metaLength = new DataView(data.buffer, data.byteOffset).getUint16(1);
  let meta: Meta;
  try {
    meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(3, 3 + metaLength)));
  } catch {
    throw fail();
  }
  if (meta?.v !== 1 || (meta.k !== 'file' && meta.k !== 'text') || typeof meta.n !== 'string' || typeof meta.h !== 'string') throw fail();
  let body = data.subarray(3 + metaLength);
  if (data[0]! & FLAG_DEFLATE) {
    if (typeof DecompressionStream !== 'function') throw fail('Bu tarayıcı sıkıştırılmış veriyi açamıyor.');
    try {
      body = await pipe(body, new DecompressionStream('deflate-raw'));
    } catch {
      throw fail();
    }
  }
  if (body.length !== meta.s || (await sha256Hex(body)) !== meta.h) throw fail();
  return { kind: meta.k, name: meta.k === 'file' ? sanitizeFileName(meta.n) : '', bytes: body };
}

export type FeedResult = 'ignored' | 'duplicate' | 'progress' | 'restarted';

/**
 * Receiver side: turns scanned QR texts into the sender's data. A frame from
 * a different stream (the sender picked another file or speed) starts over.
 */
export class AirReceiver {
  decoder: FountainDecoder | null = null;

  feed(text: string): FeedResult {
    const frame = decodeFrame(text);
    if (!frame) return 'ignored';
    let restarted = false;
    if (!this.decoder?.matches(frame)) {
      restarted = this.decoder !== null;
      this.decoder = new FountainDecoder(frame);
    }
    const added = this.decoder.add(frame.id, frame.data);
    return restarted ? 'restarted' : added ? 'progress' : 'duplicate';
  }

  get header(): StreamHeader | null {
    return this.decoder?.header ?? null;
  }
}
