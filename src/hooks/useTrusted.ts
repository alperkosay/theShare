import { useSyncExternalStore } from 'react';
import { dbGet, dbPut } from '../lib/storage/db';
import { parseTrusted, upsertTrusted, type PeerClaim, type TrustedDevice } from '../lib/storage/trusted';

const TRUSTED_KEY = 'trusted';

/** The verified devices list (lib/storage/trusted), saved in the profile store. Works in memory if storage fails. */
class TrustedStore {
  private list: TrustedDevice[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.list;

  async load(): Promise<void> {
    try {
      this.set(parseTrusted(await dbGet('profile', TRUSTED_KEY)));
    } catch {
      // Storage unavailable: nothing remembered from earlier visits.
    }
  }

  trust(fingerprint: string, claim: PeerClaim | null): void {
    this.save(upsertTrusted(this.list, fingerprint, claim));
  }

  remove(fingerprint: string): void {
    this.save(this.list.filter((d) => d.fingerprint !== fingerprint));
  }

  /** After "reset everything" deleted the database. */
  forgetAll(): void {
    this.set([]);
  }

  private set(list: TrustedDevice[]): void {
    this.list = list;
    for (const l of this.listeners) l();
  }

  private save(list: TrustedDevice[]): void {
    this.set(list);
    void dbPut('profile', list, TRUSTED_KEY).catch(() => {});
  }
}

export const trusted = new TrustedStore();

export function useTrusted(): TrustedDevice[] {
  return useSyncExternalStore(trusted.subscribe, trusted.getSnapshot);
}
