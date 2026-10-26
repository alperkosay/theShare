import { useSyncExternalStore } from 'react';

/**
 * The pop-out window (Document Picture-in-Picture): an always-on-top window
 * with the shared screen, its drawings and the chat. Most useful to whoever
 * shares a different window: they see the viewer's drawings and laser and can
 * answer in the chat without switching back to this tab.
 */
class PopoutStore {
  private win: Window | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.win;

  get supported(): boolean {
    return typeof window.documentPictureInPicture?.requestWindow === 'function';
  }

  private set(win: Window | null) {
    this.win = win;
    for (const l of this.listeners) l();
  }

  /** Call from a click. Resolves to false if the browser refused. */
  async open(): Promise<boolean> {
    if (this.win) {
      this.win.focus();
      return true;
    }
    let win: Window;
    try {
      win = await window.documentPictureInPicture!.requestWindow({ width: 460, height: 640 });
    } catch {
      return false;
    }
    win.document.title = 'theShare';
    const stopMirroring = mirrorDocument(win.document);
    win.addEventListener('pagehide', () => {
      stopMirroring();
      if (this.win === win) this.set(null);
    });
    this.set(win);
    return true;
  }

  close(): void {
    const win = this.win;
    this.set(null);
    win?.close();
  }
}

/** Copies the app's styles and theme attributes into the pop-out, and keeps the theme in sync. */
function mirrorDocument(target: Document): () => void {
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    target.head.appendChild(node.cloneNode(true));
  }
  const syncAttributes = () => {
    for (const { name, value } of [...document.documentElement.attributes]) {
      if (name.startsWith('data-')) target.documentElement.setAttribute(name, value);
    }
  };
  syncAttributes();
  target.body.className = 'popout-body';
  const observer = new MutationObserver(syncAttributes);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

export const popout = new PopoutStore();

export function usePopout(): Window | null {
  return useSyncExternalStore(popout.subscribe, popout.getSnapshot);
}
