import { encode } from 'uqr';

/** Above this the QR gets too dense to scan reliably from a phone screen. */
export const MAX_QR_TEXT_LENGTH = 1200;

export interface QrModules {
  size: number;
  /** data[y][x]: true for a dark module. Includes the quiet zone. */
  data: boolean[][];
}

export interface QrMatrix {
  size: number;
  /** SVG path data, one 1×1 square per dark module. */
  path: string;
}

/**
 * Raw module grid, or null if the text doesn't fit. Streams (lib/qr/airgap)
 * use ECC level L: a lost frame there is made up by the next ones.
 */
export function encodeQr(text: string, ecc: 'L' | 'M' = 'M'): QrModules | null {
  try {
    return encode(text, { ecc, border: 2 });
  } catch {
    return null;
  }
}

/** Returns null when the text is too long for a comfortably scannable QR code. */
export function createQr(text: string): QrMatrix | null {
  if (text.length > MAX_QR_TEXT_LENGTH) return null;
  const qr = encodeQr(text);
  if (!qr) return null;
  let path = '';
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return { size: qr.size, path };
}
