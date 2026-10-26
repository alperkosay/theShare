import { useSyncExternalStore } from 'react';
import { dbGet, dbPut } from '../lib/storage/db';
import { selfDevice } from '../lib/device';
import { canPickFolder, resolveSaveMode, saveFiles, type SaveMode } from '../lib/transfer/save';
import type { TransferView } from '../lib/transfer/manager';
import { canZip, defaultZipName, zipFiles } from '../lib/transfer/zip';
import { profile, useProfile } from './useProfile';
import { session } from './useSession';

const FOLDER_KEY = 'saveFolder';

/**
 * Where received files are saved: the mode from the settings, resolved for
 * this browser, plus the save folder (a directory handle kept in IndexedDB;
 * Chromium desktop only). The folder is handed to the transfer manager so
 * accepted files go straight into it.
 */
class SavingStore {
  private folder: FileSystemDirectoryHandle | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    session.saveFolder = () => (this.mode() === 'folder' ? this.folder : null);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.folder;

  private set(folder: FileSystemDirectoryHandle | null) {
    this.folder = folder;
    for (const l of this.listeners) l();
  }

  async load(): Promise<void> {
    if (!profile.persistent || !canPickFolder()) return;
    try {
      this.set((await dbGet<FileSystemDirectoryHandle>('profile', FOLDER_KEY)) ?? null);
    } catch {
      // Unreadable: the setting falls back to the browser's downloads.
    }
  }

  /** Opens the folder picker (call from a click) and switches the setting to it. Rejects with AbortError if dismissed. */
  async pickFolder(): Promise<void> {
    const dir = await window.showDirectoryPicker!({ id: 'theshare-save', mode: 'readwrite', startIn: 'downloads' });
    this.set(dir);
    if (profile.persistent) await dbPut('profile', dir, FOLDER_KEY).catch(() => {});
    await profile.updateSettings({ saveMode: 'folder' });
  }

  /** After "reset everything" deleted the database. */
  forget(): void {
    this.set(null);
  }

  mode(setting: SaveMode = profile.getSnapshot().settings.saveMode): Exclude<SaveMode, 'auto'> {
    return resolveSaveMode(setting, this.folder !== null, selfDevice().os);
  }

  /** Saves some of a transfer's received files. Call from a click. Returns a user-facing error, or null. */
  async saveReceived(t: TransferView, indices: number[]): Promise<string | null> {
    const picked = indices.filter((i) => t.received[i]?.file);
    if (!picked.length) return null;
    const result = await saveFiles(
      picked.map((i) => t.received[i]!.file!),
      this.mode(),
      this.folder,
    );
    if (!result.saved) return result.error;
    session.manager?.markSaved(t.id, picked);
    return null;
  }

  /** Saves all received files of a transfer as one ZIP. Returns a user-facing error, or null. */
  async saveAsZip(t: TransferView): Promise<string | null> {
    const indices = t.received.flatMap((r, i) => (r.file ? [i] : []));
    const files = indices.map((i) => t.received[i]!.file!);
    if (!canZip(files)) return 'Bu dosyalar tek bir ZIP için fazla büyük.';
    let zip: File;
    try {
      zip = await zipFiles(files, defaultZipName());
    } catch {
      return 'ZIP oluşturulamadı.';
    }
    const result = await saveFiles([zip], this.mode(), this.folder);
    if (!result.saved) return result.error;
    session.manager?.markSaved(t.id, indices);
    return null;
  }
}

export const saving = new SavingStore();

export interface SaveTarget {
  /** What actually happens on this device. */
  mode: Exclude<SaveMode, 'auto'>;
  folder: FileSystemDirectoryHandle | null;
}

export function useSaveTarget(): SaveTarget {
  const { settings } = useProfile();
  const folder = useSyncExternalStore(saving.subscribe, saving.getSnapshot);
  return { mode: saving.mode(settings.saveMode), folder };
}
