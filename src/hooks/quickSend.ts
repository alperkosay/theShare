import { session } from './useSession';
import { toast } from './useToast';
import { canPickWithHandles, pickFilesWithHandles } from '../lib/storage/resend';

/**
 * One-step sending used outside the Files and Clipboard tabs: the command
 * palette, the desktop hub, a drop anywhere on the window, Ctrl+V anywhere.
 * Results are reported as toasts.
 */

const peer = () => session.getSnapshot().peerName ?? 'karşı cihaz';

export function sendFilesNow(files: File[]): boolean {
  if (!files.length) return false;
  if (session.getSnapshot().linkState !== 'connected') {
    toast.show('Göndermek için önce bir cihaza bağlanın.', 'error');
    return false;
  }
  const error = session.sendFiles(files);
  if (error) {
    toast.show(error, 'error');
    return false;
  }
  const what = files.length === 1 ? `“${files[0]!.name}”` : `${files.length} dosya`;
  toast.show(`${what} ${peer()} cihazına önerildi; onaylayınca gider.`);
  return true;
}

export function sendTextNow(text: string): boolean {
  if (!text.trim()) return false;
  if (session.getSnapshot().linkState !== 'connected') {
    toast.show('Göndermek için önce bir cihaza bağlanın.', 'error');
    return false;
  }
  const error = session.sendText(text);
  if (error) {
    toast.show(error, 'error');
    return false;
  }
  toast.show(`Metin ${peer()} cihazına gönderildi.`);
  return true;
}

/** Opens the file picker (call from a click or key press) and sends what was picked. */
export async function pickAndSend(): Promise<void> {
  let files: File[] = [];
  if (canPickWithHandles()) {
    try {
      files = await pickFilesWithHandles();
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      files = await pickWithInput();
    }
  } else {
    files = await pickWithInput();
  }
  sendFilesNow(files);
}

function pickWithInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** Reads the clipboard's text and sends it (needs a user gesture). */
export async function sendClipboardNow(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return toast.show('Pano boş.', 'error');
    sendTextNow(text);
  } catch {
    toast.show('Panoya erişilemedi. Ctrl+V ile yapıştırarak gönderebilirsiniz.', 'error');
  }
}
