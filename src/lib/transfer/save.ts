import type { DeviceOs } from '../device';
import { canSaveToDisk, uniqueFileHandle } from './sinks';

/**
 * Where received files go when the user saves them.
 *
 *  download  The browser's download folder (Android: Download, iOS: Files ›
 *            Downloads, desktop: the browser's setting).
 *  share     The OS share sheet. On iOS this is the only way to pick a place:
 *            "Save to Files" (any folder) or "Save Image/Video" (Photos).
 *  folder    A folder picked once in the settings (Chromium desktop). Accepted
 *            transfers are written straight into it.
 *  auto      share on iOS, download elsewhere.
 */
export type SaveMode = 'auto' | 'download' | 'share' | 'folder';
export const SAVE_MODES: readonly SaveMode[] = ['auto', 'download', 'share', 'folder'];

export type SaveResult = { saved: true } | { saved: false; error: string | null };

/** Multiple downloads in one go: Chrome asks once, but back-to-back clicks can still get dropped. */
const DOWNLOAD_GAP_MS = 350;
const REVOKE_AFTER_MS = 60_000;

export function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['x'], 'x.txt', { type: 'text/plain' })] });
  } catch {
    return false;
  }
}

export function canPickFolder(): boolean {
  return canSaveToDisk() && typeof window.showDirectoryPicker === 'function';
}

/** What a setting means on this device; options the browser can't do fall back to auto. */
export function resolveSaveMode(mode: SaveMode, hasFolder: boolean, os: DeviceOs, share = canShareFiles(), folder = canPickFolder()): Exclude<SaveMode, 'auto'> {
  if (mode === 'folder' && hasFolder && folder) return 'folder';
  if (mode === 'share' && share) return 'share';
  if (mode === 'download') return 'download';
  return os === 'ios' && share ? 'share' : 'download';
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};

/**
 * Received files are typed application/octet-stream so they never render in
 * our origin. The share sheet needs the real type to offer "Save Image" etc.;
 * it comes from the extension, not from what the sender claimed.
 */
export function shareType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return (name.includes('.') && MIME[ext]) || 'application/octet-stream';
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

async function downloadAll(files: File[]): Promise<SaveResult> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_GAP_MS));
    download(files[i]!);
  }
  return { saved: true };
}

async function share(files: File[]): Promise<SaveResult> {
  const typed = files.map((f) => new File([f], f.name, { type: shareType(f.name) }));
  if (!navigator.canShare?.({ files: typed })) {
    // Too many/large files, or a type the browser won't share (Chrome: e.g. zip).
    return downloadAll(files);
  }
  try {
    await navigator.share({ files: typed });
    return { saved: true };
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'AbortError') return { saved: false, error: null };
    // NotAllowedError: the click's user activation ran out (e.g. after building a ZIP).
    return downloadAll(files);
  }
}

/** Writes files into the chosen folder. Call from a click: may ask for permission again. */
async function writeToFolder(dir: FileSystemDirectoryHandle, files: File[]): Promise<SaveResult> {
  if ((await dir.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
    return { saved: false, error: 'Klasöre yazma izni verilmedi.' };
  }
  try {
    for (const file of files) {
      const writable = await (await uniqueFileHandle(dir, file.name)).createWritable();
      await file.stream().pipeTo(writable);
    }
    return { saved: true };
  } catch {
    return { saved: false, error: 'Klasöre yazılamadı. Klasör taşınmış ya da silinmiş olabilir; ayarlardan yeniden seç.' };
  }
}

/** Saves received files the chosen way. Must run from a click (share sheet, permission prompt). */
export function saveFiles(files: File[], mode: Exclude<SaveMode, 'auto'>, folder: FileSystemDirectoryHandle | null): Promise<SaveResult> {
  if (mode === 'folder' && folder) return writeToFolder(folder, files);
  if (mode === 'share') return share(files);
  return downloadAll(files);
}

/** Tells the user where saved files end up on this device. */
export function saveHint(mode: Exclude<SaveMode, 'auto'>, os: DeviceOs, folderName: string | null): string {
  switch (mode) {
    case 'folder':
      return `Kabul ettiğin dosyalar doğrudan "${folderName}" klasörüne yazılır.`;
    case 'share':
      return os === 'ios'
        ? `Kaydet'e basınca paylaş menüsü açılır: fotoğraf ve videolar için "Görüntüyü/Videoyu Kaydet" (Fotoğraflar), diğerleri için "Dosyalar'a Kaydet" ile klasörü sen seçersin.`
        : `Kaydet'e basınca paylaş menüsü açılır; dosyayı hangi uygulamaya ya da klasöre kaydedeceğini sen seçersin.`;
    default:
      if (os === 'ios') return `Dosyalar uygulamasında İndirilenler klasörüne gider. Konumu Ayarlar › Safari › İndirilenler'den değiştirebilirsin.`;
      if (os === 'android') return 'Telefonun İndirilenler (Download) klasörüne gider; Dosyalar uygulamasından ulaşabilirsin.';
      return 'Tarayıcının indirme klasörüne gider. Konumu tarayıcının ayarlarından değiştirebilir ya da her indirmede sorulmasını açabilirsin.';
  }
}

/** Short "where did it go" after a save, shown on the transfer card. */
export function savedLabel(mode: Exclude<SaveMode, 'auto'>, os: DeviceOs, folderName: string | null): string | null {
  if (mode === 'folder') return `"${folderName}" klasörüne kaydedildi`;
  if (mode === 'share') return null;
  if (os === 'ios') return `Dosyalar › İndirilenler'e kaydedildi`;
  return 'İndirilenler klasörüne kaydedildi';
}
