import { useSyncExternalStore } from 'react';
import { setSelfIdentity } from '../lib/device';
import { dbGet, dbPut, deleteDb } from '../lib/storage/db';
import { newProfile, normalizeProfile, type Profile, type Scheme, type Settings } from '../lib/storage/profile';

const PROFILE_KEY = 'me';
/** A broken IndexedDB (some private modes) must not keep the app from starting. */
const LOAD_TIMEOUT_MS = 1500;

const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');

/**
 * Light/dark tokens in styles.css hang off data-scheme on <html>, always
 * "light" or "dark": "system" is resolved here and follows the device live.
 * The browser bar (theme-color) takes the page background.
 */
function applyScheme(scheme: Scheme): void {
  const root = document.documentElement;
  root.dataset.scheme = scheme === 'dark' || (scheme === 'system' && systemDark?.matches) ? 'dark' : 'light';
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  if (bg) for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = bg;
}

/**
 * The user's name, persistent device id and settings, saved only on this
 * device. Loaded once before the first render (see main.tsx) so the name is
 * right from the start; works in memory if storage is unavailable.
 */
class ProfileStore {
  private state: Profile = newProfile();
  private listeners = new Set<() => void>();
  /** False when IndexedDB failed: nothing persists, the settings say so. */
  persistent = true;

  constructor() {
    // Right away, so the first paint already has the device's light/dark; the saved choice follows on load.
    applyScheme(this.state.settings.scheme);
    systemDark?.addEventListener?.('change', () => applyScheme(this.state.settings.scheme));
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private apply(profile: Profile) {
    this.state = profile;
    setSelfIdentity(profile.name, profile.deviceId);
    // Themes are token sets in styles.css, selected by this attribute.
    document.documentElement.dataset.theme = profile.settings.theme;
    applyScheme(profile.settings.scheme);
    for (const l of this.listeners) l();
  }

  async load(): Promise<void> {
    try {
      const stored = await Promise.race([
        dbGet<Partial<Profile>>('profile', PROFILE_KEY),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)),
      ]);
      const profile = normalizeProfile(stored);
      this.apply(profile);
      // A fresh random name and id are saved too, so the device keeps them across visits.
      if (!stored) await this.save(profile);
    } catch {
      this.persistent = false;
      this.apply(this.state);
    }
  }

  update(patch: Partial<Profile>): Promise<void> {
    const profile = { ...this.state, ...patch };
    this.apply(profile);
    return this.save(profile);
  }

  updateSettings(patch: Partial<Settings>): Promise<void> {
    if (Object.values(patch).some((v) => v === true)) void requestPersistence();
    return this.update({ settings: { ...this.state.settings, ...patch } });
  }

  /** "Reset everything": deletes all stored data and starts over with a new random identity. */
  async reset(): Promise<void> {
    await deleteDb();
    const profile = newProfile();
    this.apply(profile);
    await this.save(profile);
  }

  private async save(profile: Profile): Promise<void> {
    if (!this.persistent) return;
    try {
      await dbPut('profile', profile, PROFILE_KEY);
    } catch {
      // Storage full or gone; the in-memory profile still works for this visit.
    }
  }
}

/** Asks the browser not to evict our data under storage pressure (silent in Chromium, a prompt in Firefox). */
export async function requestPersistence(): Promise<void> {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();
  } catch {
    // Not supported; data is then "best effort".
  }
}

export const profile = new ProfileStore();

export function useProfile(): Profile {
  return useSyncExternalStore(profile.subscribe, profile.getSnapshot);
}
