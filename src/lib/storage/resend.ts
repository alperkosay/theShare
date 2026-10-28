import type { ResendRecord } from './history';
import { zipFolder } from '../transfer/folder';

/**
 * Where a file we're sending came from, so the history can keep it for resend:
 *  - a FileSystemFileHandle (Chromium desktop pickers/drag-and-drop): costs no space;
 *  - an existing resend record (it's a resend): reuse that record instead of copying again.
 */
const handles = new WeakMap<File, FileSystemFileHandle>();
const records = new WeakMap<File, string>();

export const handleOf = (file: File) => handles.get(file);
export const recordOf = (file: File) => records.get(file);

export function canPickWithHandles(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof window.showOpenFilePicker === 'function';
}

/** Opens the picker that hands out handles. Must be the first await in a click handler. Rejects with AbortError on dismiss. */
export async function pickFilesWithHandles(): Promise<File[]> {
  const picked = await window.showOpenFilePicker!({ multiple: true, id: 'theshare-send' });
  return Promise.all(
    picked.map(async (handle) => {
      const file = await handle.getFile();
      handles.set(file, handle);
      return file;
    }),
  );
}

/**
 * Files from a drop, with their handles where the browser offers them.
 * Dropped folders come back zipped; `onZipping` fires first if there are any.
 */
export async function filesFromDrop(data: DataTransfer, onZipping?: () => void): Promise<File[]> {
  // Everything has to be read synchronously, inside the drop event.
  const items = [...data.items].filter((i) => i.kind === 'file');
  const pairs = items.map((item) => {
    const entry = item.webkitGetAsEntry?.() ?? null;
    const dir = entry?.isDirectory ? (entry as FileSystemDirectoryEntry) : null;
    return { file: item.getAsFile(), dir, handle: dir ? null : (item.getAsFileSystemHandle?.() ?? null) };
  });
  if (pairs.some((p) => p.dir)) onZipping?.();
  const files: File[] = [];
  for (const { file, dir, handle } of pairs) {
    if (dir) {
      files.push(await zipFolder(dir));
      continue;
    }
    if (!file) continue;
    const h = await handle?.catch(() => null);
    if (h?.kind === 'file') handles.set(file, h as FileSystemFileHandle);
    files.push(file);
  }
  return files.length ? files : Array.from(data.files);
}

export type ResolveResult = { files: File[] } | { error: string };

/**
 * Turns a stored record back into Files. Handles need read permission again
 * after a reload: the prompt needs the user's click, so call this from one.
 */
export async function resolveRecord(record: ResendRecord): Promise<ResolveResult> {
  if (record.mode === 'copy') {
    for (const f of record.items) records.set(f, record.key);
    return { files: record.items };
  }
  const files: File[] = [];
  for (const handle of record.items) {
    try {
      let permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
      if (permission !== 'granted') permission = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
      if (permission !== 'granted') return { error: 'Dosyayı okumak için izin verilmedi.' };
      const file = await handle.getFile();
      handles.set(file, handle);
      records.set(file, record.key);
      files.push(file);
    } catch {
      return { error: `"${handle.name}" bulunamadı. Taşınmış ya da silinmiş olabilir.` };
    }
  }
  return { files };
}
