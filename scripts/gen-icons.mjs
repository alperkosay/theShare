// Generates the PWA PNG icons without image tooling dependencies.
// Usage: node scripts/gen-icons.mjs   (outputs into public/)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Background: diagonal violet → cyan gradient (matches --grad in styles.css).
const BG_FROM = [139, 92, 246];
const BG_TO = [34, 211, 238];
const FG = [255, 255, 255];
const SAMPLES = 4; // supersampling per axis for anti-aliasing

// Shapes in normalized 0..1 coordinates, kept inside the maskable safe zone (central 80%).
const inTriangle = (x, y) => {
  const [ax, ay, bx, by, cx, cy] = [0.5, 0.2, 0.29, 0.43, 0.71, 0.43];
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const isForeground = (x, y) =>
  inTriangle(x, y) ||
  inRect(x, y, 0.44, 0.4, 0.56, 0.63) || // arrow stem
  inRect(x, y, 0.25, 0.73, 0.75, 0.79) || // tray bottom
  inRect(x, y, 0.25, 0.58, 0.31, 0.79) || // tray left
  inRect(x, y, 0.69, 0.58, 0.75, 0.79); // tray right

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
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (isForeground((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size)) hits++;
        }
      }
      const a = hits / (SAMPLES * SAMPLES);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      const t = (x + y) / (2 * (size - 1));
      for (let i = 0; i < 3; i++) {
        const bg = BG_FROM[i] * (1 - t) + BG_TO[i] * t;
        raw[o + i] = Math.round(bg * (1 - a) + FG[i] * a);
      }
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
