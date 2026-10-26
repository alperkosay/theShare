import { useSyncExternalStore } from 'react';
import { detectDeviceOs } from '../lib/device';

/** Chromium's install event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * How this app can be installed here:
 *  installed  already running as an installed app (or just installed)
 *  prompt     Chromium offered its install dialog (beforeinstallprompt)
 *  ios        iOS/iPadOS: only by hand, Share › Add to Home Screen
 *  manual     anything else: maybe through the browser menu, maybe not at all
 */
export type InstallWay = 'installed' | 'prompt' | 'ios' | 'manual';

const SEEN_KEY = 'theshare-install-seen';

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

class InstallStore {
  private deferred: BeforeInstallPromptEvent | null = null;
  private way: InstallWay;
  private listeners = new Set<() => void>();

  constructor() {
    this.way = this.detect();
    // Chromium fires this once, possibly before React renders: listen from module load (imported in main.tsx).
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // our own prompt instead of the browser's mini bar
      this.deferred = e as BeforeInstallPromptEvent;
      this.update();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.way = 'installed';
      this.markSeen();
      this.emit();
    });
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => this.update());
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.way;

  private detect(): InstallWay {
    if (isStandalone()) return 'installed';
    if (this.deferred) return 'prompt';
    return detectDeviceOs() === 'ios' ? 'ios' : 'manual';
  }

  private update() {
    const way = this.detect();
    if (way === this.way) return;
    this.way = way;
    this.emit();
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Shows the browser's install dialog. Call from a click. Resolves true if the user installed. */
  async install(): Promise<boolean> {
    const event = this.deferred;
    if (!event) return false;
    this.deferred = null; // single use
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') this.way = 'installed';
    else this.way = this.detect();
    this.emit();
    return outcome === 'accepted';
  }

  /** The first-run install suggestion is shown once per device. */
  get seen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return true; // can't remember a dismissal: better never than every visit
    }
  }

  markSeen(): void {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Private mode.
    }
  }
}

export const install = new InstallStore();

export function useInstall(): InstallWay {
  return useSyncExternalStore(install.subscribe, install.getSnapshot);
}
