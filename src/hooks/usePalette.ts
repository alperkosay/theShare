import { useSyncExternalStore } from 'react';

/** Whether the command palette (Ctrl+K) is open; buttons anywhere can open it. */
class PaletteStore {
  private isOpen = false;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.isOpen;

  set(open: boolean): void {
    if (open === this.isOpen) return;
    this.isOpen = open;
    for (const l of this.listeners) l();
  }

  open = () => this.set(true);
  close = () => this.set(false);
  toggle = () => this.set(!this.isOpen);
}

export const palette = new PaletteStore();

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(palette.subscribe, palette.getSnapshot);
}
