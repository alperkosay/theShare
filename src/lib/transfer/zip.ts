/**
 * Builds an uncompressed ("stored") ZIP from Files without copying their
 * contents into memory: the result is a Blob composed of small headers and the
 * original Files. Each file is read once to compute its CRC-32.
 *
 * No compression on purpose: photos/videos/archives — the usual payload —
 * don't shrink, and storing keeps it fast and memory-flat on phones.
 * Classic ZIP (no ZIP64): total size must stay under 4 GiB.
 */

export const ZIP_MAX_BYTES = 0xffffffff - 64 * 1024 * 1024;
export const ZIP_MAX_FILES = 65_535;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

async function crc32(file: Blob): Promise<number> {
  let crc = 0xffffffff;
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let i = 0; i < value.length; i++) crc = CRC_TABLE[(crc ^ value[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(ms: number): { time: number; date: number } {
  const d = new Date(ms);
  if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** True if these files can go into a single classic ZIP. */
export function canZip(files: File[]): boolean {
  if (files.length < 2 || files.length > ZIP_MAX_FILES) return false;
  const overhead = files.reduce((sum, f) => sum + 128 + 2 * f.name.length * 3, 22);
  return files.reduce((sum, f) => sum + f.size, overhead) < ZIP_MAX_BYTES;
}

function uniqueNames(files: File[]): string[] {
  const seen = new Set<string>();
  return files.map((f) => {
    const name = f.name || 'dosya';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let i = 1; seen.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export async function zipFiles(files: File[], zipName: string): Promise<File> {
  if (!canZip(files)) throw new Error('Bu dosyalar tek bir ZIP için fazla büyük.');
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const names = uniqueNames(files);
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const name = enc.encode(names[i]!);
    const crc = await crc32(file);
    const { time, date } = dosDateTime(file.lastModified);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.size, true);
    lv.setUint32(22, file.size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.size, true);
    cv.setUint32(24, file.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); // local header offset
    entry.set(name, 46);

    parts.push(local, file);
    central.push(entry);
    offset += local.length + file.size;
  }

  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory signature
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new File([...parts, ...central, end], zipName, { type: 'application/zip' });
}

export function defaultZipName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `theShare_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}.zip`;
}
