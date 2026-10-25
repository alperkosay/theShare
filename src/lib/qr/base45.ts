/**
 * Base45 (RFC 9285): bytes as text from exactly the 45 characters of the QR
 * alphanumeric mode, which packs them at 5.5 bits each. Byte-mode base64
 * spends 8 bits per 6-bit character, so this fits ~30% more data per QR.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const VALUES = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encodeBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    let n = bytes[i]! * 256 + bytes[i + 1]!;
    for (let j = 0; j < 3; j++, n = Math.floor(n / 45)) out += ALPHABET[n % 45];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1]!;
    out += ALPHABET[n % 45]! + ALPHABET[Math.floor(n / 45)]!;
  }
  return out;
}

/** Returns null for text that isn't valid base45. */
export function decodeBase45(text: string): Uint8Array | null {
  if (text.length % 3 === 1) return null;
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const chunk = text.slice(i, i + 3);
    let n = 0;
    for (let j = chunk.length - 1; j >= 0; j--) {
      const v = VALUES.get(chunk[j]!);
      if (v === undefined) return null;
      n = n * 45 + v;
    }
    if (chunk.length === 3) {
      if (n > 0xffff) return null;
      out[o++] = n >> 8;
      out[o++] = n & 0xff;
    } else {
      if (n > 0xff) return null;
      out[o++] = n;
    }
  }
  return out;
}
