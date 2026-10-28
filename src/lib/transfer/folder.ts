import { zipEntries, type ZipEntry } from './zip';

/**
 * A dropped folder reaches us as a 0-byte File. Instead we walk its entries
 * and send it as "<folder>.zip", keeping the tree (empty folders included).
 */

const readBatch = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function walk(dir: FileSystemDirectoryEntry, prefix: string, out: ZipEntry[]): Promise<void> {
  out.push({ path: `${prefix}/` });
  const reader = dir.createReader();
  // readEntries hands the listing out in batches (100 in Chromium) until it returns none.
  for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
    for (const entry of batch) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory) await walk(entry as FileSystemDirectoryEntry, path, out);
      else if (entry.isFile) out.push({ path, file: await fileOf(entry as FileSystemFileEntry) });
    }
  }
}

export async function zipFolder(dir: FileSystemDirectoryEntry): Promise<File> {
  const name = dir.name || 'klasör';
  const entries: ZipEntry[] = [];
  try {
    await walk(dir, name, entries);
  } catch {
    throw new Error(`"${name}" klasörü okunamadı.`);
  }
  return zipEntries(entries, `${name}.zip`);
}
