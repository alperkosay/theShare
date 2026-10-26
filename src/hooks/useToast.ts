import { useSyncExternalStore } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

const SHOW_MS = 3500;

/** Short app-wide notices (a file dropped anywhere, a paste sent, a palette command's result). */
class ToastStore {
  private current: ToastMessage | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.current;

  private set(value: ToastMessage | null) {
    this.current = value;
    for (const l of this.listeners) l();
  }

  show(text: string, tone: ToastMessage['tone'] = 'info'): void {
    clearTimeout(this.timer);
    this.set({ id: this.nextId++, text, tone });
    this.timer = setTimeout(() => this.set(null), SHOW_MS);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.set(null);
  }
}

export const toast = new ToastStore();

export function useToast(): ToastMessage | null {
  return useSyncExternalStore(toast.subscribe, toast.getSnapshot);
}
