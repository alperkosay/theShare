/**
 * One-way transfer over a stream of QR codes, with a fountain code.
 *
 * There is no back channel: the receiver can't ask for a frame it missed (the
 * camera blinked, the codes changed mid-exposure, it started late). So the
 * data is cut into K blocks and the sender emits an endless stream of
 * symbols: first the K blocks themselves, then XORs of random halves of all
 * blocks. Any K independent symbols, in any order, rebuild the data; a random
 * half-mix is independent of what came before with probability ≥ 1/2, so in
 * practice K + 2 or so distinct symbols are enough.
 *
 * Which blocks a symbol combines is derived from (stream id, symbol id) with a
 * seeded PRNG, so a frame only carries its id, not the block list.
 *
 * Frame: "TSQ:" + base45(version u8 · stream id u32 · data length u32 ·
 *        block size u16 · symbol id u32 · symbol bytes), big-endian.
 */

import { decodeBase45, encodeBase45 } from './base45';

export const FRAME_PREFIX = 'TSQ:';
const VERSION = 1;
const HEADER_BYTES = 15;
export const MAX_BLOCK_SIZE = 2048;

export interface StreamHeader {
  /** Random per stream, so frames from another stream are never mixed in. */
  sid: number;
  /** Total data length in bytes. */
  length: number;
  blockSize: number;
}

export interface Frame extends StreamHeader {
  id: number;
  data: Uint8Array;
}

export const blockCount = (h: StreamHeader) => Math.max(1, Math.ceil(h.length / h.blockSize));

export function encodeFrame(f: Frame): string {
  const bytes = new Uint8Array(HEADER_BYTES + f.data.length);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint32(1, f.sid);
  view.setUint32(5, f.length);
  view.setUint16(9, f.blockSize);
  view.setUint32(11, f.id);
  bytes.set(f.data, HEADER_BYTES);
  return FRAME_PREFIX + encodeBase45(bytes);
}

/** Returns null for anything that isn't a well-formed frame (e.g. some other QR code). */
export function decodeFrame(text: string): Frame | null {
  if (!text.startsWith(FRAME_PREFIX)) return null;
  const bytes = decodeBase45(text.slice(FRAME_PREFIX.length));
  if (!bytes || bytes.length <= HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== VERSION) return null;
  const frame: Frame = {
    sid: view.getUint32(1),
    length: view.getUint32(5),
    blockSize: view.getUint16(9),
    id: view.getUint32(11),
    data: bytes.subarray(HEADER_BYTES),
  };
  if (frame.blockSize === 0 || frame.blockSize > MAX_BLOCK_SIZE || frame.data.length !== frame.blockSize) return null;
  return frame;
}

// --- symbol → block set -------------------------------------------------------

/** mulberry32, yielding 32-bit words. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Bitset of the blocks symbol `id` is the XOR of. Ids below k are the blocks themselves. */
export function symbolBits(sid: number, id: number, k: number): Uint32Array {
  const bits = new Uint32Array(Math.ceil(k / 32));
  if (id < k) {
    bits[id >>> 5] = 1 << (id & 31);
    return bits;
  }
  const next = prng(sid ^ Math.imul(id, 0x9e3779b1));
  for (let w = 0; w < bits.length; w++) bits[w] = next();
  if (k & 31) bits[bits.length - 1]! &= (1 << (k & 31)) - 1;
  if (!bits.some(Boolean)) bits[(id % k) >>> 5] = 1 << (id % k & 31);
  return bits;
}

/** Block data is kept as 32-bit words so XORs go 4 bytes at a time. */
const wordsFor = (blockSize: number) => Math.ceil(blockSize / 4);

function xorWords(target: Uint32Array, source: Uint32Array, from = 0): void {
  for (let i = from; i < target.length; i++) target[i]! ^= source[i]!;
}

function toWords(bytes: Uint8Array, blockSize: number): Uint32Array {
  const words = new Uint32Array(wordsFor(blockSize));
  new Uint8Array(words.buffer).set(bytes.subarray(0, blockSize));
  return words;
}

// --- encoder / decoder ----------------------------------------------------------

export class FountainEncoder {
  readonly header: StreamHeader;
  readonly k: number;
  private blocks: Uint32Array[];

  constructor(data: Uint8Array, blockSize: number, sid = crypto.getRandomValues(new Uint32Array(1))[0]!) {
    if (blockSize < 1 || blockSize > MAX_BLOCK_SIZE) throw new RangeError('block size');
    this.header = { sid, length: data.length, blockSize };
    this.k = blockCount(this.header);
    this.blocks = Array.from({ length: this.k }, (_, i) => toWords(data.subarray(i * blockSize, (i + 1) * blockSize), blockSize));
  }

  symbol(id: number): Uint8Array {
    const out = new Uint32Array(wordsFor(this.header.blockSize));
    const bits = symbolBits(this.header.sid, id, this.k);
    for (let b = 0; b < this.k; b++) if (bits[b >>> 5]! & (1 << (b & 31))) xorWords(out, this.blocks[b]!);
    return new Uint8Array(out.buffer, 0, this.header.blockSize);
  }

  /** The n-th frame to show: the plain blocks first, then mixes, which fill whatever gaps are left. */
  frame(n: number): string {
    return encodeFrame({ ...this.header, id: n >>> 0, data: this.symbol(n >>> 0) });
  }
}

interface Row {
  /** The blocks this row combines; the lowest set bit is its pivot. */
  bits: Uint32Array;
  data: Uint32Array;
}

/**
 * Online Gaussian elimination over GF(2). Each symbol is reduced against the
 * rows collected so far; if anything is left, its lowest block becomes a new
 * pivot. Plain blocks land as single-bit rows and cost nothing, so the work
 * goes only into the gaps. Done when every block has a pivot.
 */
export class FountainDecoder {
  readonly header: StreamHeader;
  readonly k: number;
  private rows: Array<Row | undefined>;
  private rank = 0;
  private seen = new Set<number>();

  constructor(header: StreamHeader) {
    this.header = { sid: header.sid, length: header.length, blockSize: header.blockSize };
    this.k = blockCount(this.header);
    this.rows = new Array(this.k);
  }

  matches(h: StreamHeader): boolean {
    return h.sid === this.header.sid && h.length === this.header.length && h.blockSize === this.header.blockSize;
  }

  get done(): boolean {
    return this.rank === this.k;
  }

  /** Independent symbols so far; the data is complete at k. */
  get decoded(): number {
    return this.rank;
  }

  /** Distinct symbols received. */
  get received(): number {
    return this.seen.size;
  }

  /** Feeds a symbol; returns false if it was a duplicate (the camera reads each code several times). */
  add(id: number, bytes: Uint8Array): boolean {
    if (this.seen.has(id) || this.done) return false;
    this.seen.add(id);
    const bits = symbolBits(this.header.sid, id, this.k);
    const data = toWords(bytes, this.header.blockSize);
    for (let w = 0; w < bits.length; w++) {
      while (bits[w]) {
        const col = w * 32 + 31 - Math.clz32(bits[w]! & -bits[w]!);
        const row = this.rows[col];
        if (!row) {
          this.rows[col] = { bits, data };
          this.rank++;
          return true;
        }
        xorWords(bits, row.bits, w); // the row has no bits below its pivot
        xorWords(data, row.data);
      }
    }
    return true; // a combination of what we already have
  }

  /** The reassembled data, once done (back substitution, highest pivot first). */
  result(): Uint8Array {
    if (!this.done) throw new Error('not done');
    const { blockSize, length } = this.header;
    for (let col = this.k - 1; col >= 0; col--) {
      const row = this.rows[col]!;
      for (let w = col >>> 5; w < row.bits.length; w++) {
        let word = row.bits[w]!;
        if (w === col >>> 5) word &= ~((2 << (col & 31)) - 1); // bits above the pivot only
        for (; word; word &= word - 1) xorWords(row.data, this.rows[w * 32 + 31 - Math.clz32(word & -word)]!.data);
      }
    }
    const result = new Uint8Array(length);
    for (let col = 0; col < this.k; col++) {
      const bytes = new Uint8Array(this.rows[col]!.data.buffer, 0, blockSize);
      result.set(bytes.subarray(0, Math.min(blockSize, length - col * blockSize)), col * blockSize);
    }
    return result;
  }
}
