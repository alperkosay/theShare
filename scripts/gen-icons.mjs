// Generates the PWA PNG icons and favicon.svg without image tooling dependencies.
// The pixel art comes from src/lib/logo.ts (Node strips its types on import).
// Usage: node scripts/gen-icons.mjs   (outputs into public/)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { BOARD_ORIGIN, CELL, GRID, LOGO_PIXELS, logoSvg } from '../src/lib/logo.ts';

// Background: solid near-black (matches --ink in styles.css).
const BG = [29, 29, 31];
const FG = [255, 255, 255];
const SAMPLES = 4; // supersampling per axis for anti-aliasing

const alphaAt = new Map(LOGO_PIXELS.map((p) => [`${p.col}:${p.row}`, p.alpha]));

/** Foreground opacity at a point in normalized 0..1 coordinates. */
function coverage(x, y) {
  const gx = (x * 100 - BOARD_ORIGIN) / CELL;
  const gy = (y * 100 - BOARD_ORIGIN) / CELL;
  if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return 0;
  // Columns are placed on half-cell offsets (see COL_OFFSET in logo.ts).
  return alphaAt.get(`${Math.floor(gx - 0.5) + 0.5}:${Math.floor(gy)}`) ?? 0;
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          sum += coverage((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
        }
      }
      const a = sum / (SAMPLES * SAMPLES);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size));
  console.log(`public/${name}`);
}

writeFileSync(new URL('../public/favicon.svg', import.meta.url), logoSvg('#1d1d1f', '#ffffff'));
console.log('public/favicon.svg');
