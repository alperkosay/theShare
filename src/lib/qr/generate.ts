import { encode } from 'uqr';

/** Above this the QR gets too dense to scan reliably from a phone screen. */
export const MAX_QR_TEXT_LENGTH = 1200;

export interface QrMatrix {
  size: number;
  /** SVG path data, one 1×1 square per dark module. */
  path: string;
}

/** Returns null when the text is too long for a comfortably scannable QR code. */
export function createQr(text: string): QrMatrix | null {
  if (text.length > MAX_QR_TEXT_LENGTH) return null;
  try {
    const { size, data } = encode(text, { ecc: 'M', border: 2 });
    let path = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size, path };
  } catch {
    return null;
  }
}
