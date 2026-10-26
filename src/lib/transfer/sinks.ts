import type { FileMeta } from './protocol';

/**
 * Where incoming bytes go. Three strategies, best first:
 *
 *  disk    File System Access API (Chromium desktop). Streams straight into the
 *          file the user picked, or into the save folder chosen in the
 *          settings; nothing accumulates in memory. Needs a user gesture, so
 *          the picker/permission prompt opens from the "accept" click.
 *  opfs    Origin Private File System (Chrome/Edge/Android Chrome, Firefox,
 *          recent Safari). Streams to browser-managed disk storage, then the
 *          user downloads it. Temporary files are removed at session end.
 *  memory  Blob fallback. Chunks are merged into Blobs every few MB, which
 *          lets most browsers spill to disk, but very large files can still
 *          exhaust memory (especially on iOS).
 */

export type SinkKind = 'disk' | 'opfs' | 'memory';

export interface ReceivedResult {
  /** Present for opfs/memory sinks; the user downloads or shares it. */
  file: File | null;
}

export interface FileSink {
  write(chunk: ArrayBuffer): Promise<void>;
  close(): Promise<ReceivedResult>;
  abort(): Promise<void>;
}

export interface SinkFactory {
  kind: SinkKind;
  open(meta: FileMeta, index: number): Promise<FileSink>;
}

const OPFS_DIR = 'theshare-incoming';
const MEMORY_MERGE_BYTES = 8 * 1024 * 1024;

/** Downloads are always octet-stream so a received file can never render inside our origin. */
const DOWNLOAD_TYPE = 'application/octet-stream';

export function canSaveToDisk(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof window.showSaveFilePicker === 'function';
}

function canUseOpfs(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

// ---------------------------------------------------------------------------
// disk (File System Access API)
// ---------------------------------------------------------------------------

function writableSink(writable: FileSystemWritableFileStream, finish: () => Promise<ReceivedResult>, onAbort?: () => Promise<void>): FileSink {
  return {
    write: (chunk) => writable.write(chunk),
    close: async () => {
      await writable.close();
      return finish();
    },
    abort: async () => {
      await writable.abort().catch(() => {});
      await onAbort?.().catch(() => {});
    },
  };
}

export async function uniqueFileHandle(dir: FileSystemDirectoryHandle, name: string): Promise<FileSystemFileHandle> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? name : `${base} (${i})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch (e) {
      if ((e as DOMException).name === 'NotFoundError') return dir.getFileHandle(candidate, { create: true });
      throw e;
    }
  }
  throw new Error('Benzersiz dosya adı bulunamadı.');
}

/**
 * Opens the save picker. MUST be the first await inside the click handler,
 * otherwise the browser drops the user activation and refuses to show it.
 * Rejects with AbortError if the user dismisses the picker.
 */
export async function pickDiskTarget(files: FileMeta[]): Promise<SinkFactory> {
  if (files.length === 1) {
    const handle = await window.showSaveFilePicker!({ suggestedName: files[0]!.name, startIn: 'downloads' });
    return {
      kind: 'disk',
      open: async () => writableSink(await handle.createWritable(), async () => ({ file: null })),
    };
  }
  return directorySinkFactory(await window.showDirectoryPicker!({ id: 'theshare', mode: 'readwrite', startIn: 'downloads' }));
}

/** Writes each file into a folder the user granted access to; name clashes become "name (1).ext". */
export function directorySinkFactory(dir: FileSystemDirectoryHandle): SinkFactory {
  return {
    kind: 'disk',
    open: async (meta) => {
      const handle = await uniqueFileHandle(dir, meta.name);
      return writableSink(
        await handle.createWritable(),
        async () => ({ file: null }),
        () => dir.removeEntry(handle.name),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// opfs + memory
// ---------------------------------------------------------------------------

function memorySink(meta: FileMeta): FileSink {
  let parts: Blob[] = [];
  let pending: ArrayBuffer[] = [];
  let pendingBytes = 0;
  const flush = () => {
    if (pending.length) parts.push(new Blob(pending));
    pending = [];
    pendingBytes = 0;
  };
  return {
    write: async (chunk) => {
      pending.push(chunk);
      pendingBytes += chunk.byteLength;
      if (pendingBytes >= MEMORY_MERGE_BYTES) flush();
    },
    close: async () => {
      flush();
      const file = new File(parts, meta.name, { type: DOWNLOAD_TYPE });
      parts = [];
      return { file };
    },
    abort: async () => {
      parts = [];
      pending = [];
    },
  };
}

async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create: true });
}

async function hasStorageFor(bytes: number): Promise<boolean> {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    return quota - usage > bytes * 1.05 + 16 * 1024 * 1024;
  } catch {
    return false;
  }
}

/** Picks OPFS when available and there is enough quota, otherwise memory. */
export async function createBrowserSinkFactory(transferId: string, totalBytes: number): Promise<SinkFactory> {
  if (canUseOpfs() && (await hasStorageFor(totalBytes))) {
    try {
      const dir = await opfsDir();
      return {
        kind: 'opfs',
        open: async (meta, index) => {
          const entry = `${transferId}-${index}`;
          const handle = await dir.getFileHandle(entry, { create: true });
          return writableSink(
            await handle.createWritable(),
            async () => {
              const stored = await handle.getFile();
              return { file: new File([stored], meta.name, { type: DOWNLOAD_TYPE }) };
            },
            () => dir.removeEntry(entry),
          );
        },
      };
    } catch {
      // e.g. Firefox private windows expose the API but throw; fall through.
    }
  }
  return { kind: 'memory', open: async (meta) => memorySink(meta) };
}

/** Removes temporary OPFS files (session end, and leftovers from a crashed tab). */
export async function cleanupTemporaryFiles(): Promise<void> {
  if (!canUseOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_DIR, { recursive: true });
  } catch {
    // Nothing stored, or the files are still open in another tab.
  }
}
