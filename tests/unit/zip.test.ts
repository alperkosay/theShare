import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { canZip, zipFiles } from '../../src/lib/transfer/zip';

/** Minimal reader: walks the central directory and returns each entry's name and stored bytes. */
function readZip(buf: Buffer): Array<{ name: string; data: Buffer; crc: number }> {
  const eocd = buf.length - 22;
  expect(buf.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.push({ name, data: buf.subarray(dataStart, dataStart + size), crc });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

describe('zipFiles', () => {
  it('stores files byte-for-byte with correct CRCs, UTF-8 names and de-duplicated names', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 7, 0xab);
    const files = [
      new File(['merhaba'], 'not.txt'),
      new File([], 'boş.bin'),
      new File([big], 'büyük.bin'),
      new File(['ikinci'], 'not.txt'),
    ];
    const zip = await zipFiles(files, 'x.zip');
    expect(zip.name).toBe('x.zip');

    const entries = readZip(Buffer.from(await zip.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(['not.txt', 'boş.bin', 'büyük.bin', 'not (1).txt']);
    const originals = [Buffer.from('merhaba'), Buffer.alloc(0), big, Buffer.from('ikinci')];
    entries.forEach((e, i) => {
      expect(e.data.equals(originals[i]!)).toBe(true);
      expect(e.crc).toBe(crc32(originals[i]!));
    });
  });

  it('only zips 2+ files', () => {
    expect(canZip([new File(['a'], 'a')])).toBe(false);
    expect(canZip([new File(['a'], 'a'), new File(['b'], 'b')])).toBe(true);
  });
});
