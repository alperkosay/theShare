import { randomDeviceName } from '../device';
import { SAVE_MODES, type SaveMode } from '../transfer/save';
import { SCREEN_QUALITIES, type ScreenQuality } from '../webrtc/media';

/** "soft": neumorphism (default). "mono": black & white, Apple-like. "pastel": pastel-filled cards. */
export type Theme = 'mono' | 'pastel' | 'soft';
export const THEMES: readonly Theme[] = ['mono', 'pastel', 'soft'];

/** Light/dark: follow the device, or force one. */
export type Scheme = 'system' | 'light' | 'dark';
export const SCHEMES: readonly Scheme[] = ['system', 'light', 'dark'];

export interface Settings {
  theme: Theme;
  scheme: Scheme;
  /** Record sent and received transfers on this device. */
  keepHistory: boolean;
  /** Also record texts (first ~200 characters). Off by default: clipboards hold passwords. */
  includeTexts: boolean;
  /** Keep a copy of sent files for one-tap resend where file handles aren't available. */
  keepFiles: boolean;
  /** History older than this is deleted; null keeps it forever. */
  retentionDays: number | null;
  /** Where received files are saved (lib/transfer/save). */
  saveMode: SaveMode;
  /** Screen sharing: the quality preset, and whether to offer sharing sound (lib/webrtc/media). */
  screenQuality: ScreenQuality;
  screenAudio: boolean;
}

export interface Profile {
  name: string;
  /** Random UUID sent in the connection hello; groups history by device. Not authentication. */
  deviceId: string;
  /** Avatar hue, 0–359. */
  hue: number;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'soft',
  scheme: 'system',
  keepHistory: true,
  includeTexts: false,
  keepFiles: true,
  retentionDays: 90,
  saveMode: 'auto',
  screenQuality: 'detail',
  screenAudio: false,
};

export const NAME_MIN = 2;
export const NAME_MAX = 24;

export function randomHue(): number {
  return crypto.getRandomValues(new Uint16Array(1))[0]! % 360;
}

export function newProfile(): Profile {
  return { name: randomDeviceName(), deviceId: crypto.randomUUID(), hue: randomHue(), settings: { ...DEFAULT_SETTINGS } };
}

/** Counts what a person sees as characters, so "👩‍💻" is one, not five. */
function visibleLength(text: string): number {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter().segment(text)].length;
  return [...text].length;
}

/** Control characters and the bidi overrides that can make a name read as something else. */
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

/** Validates a display name typed by the user. Returns the cleaned name, or a user-facing error. */
export function validateName(raw: string): { name: string } | { error: string } {
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (FORBIDDEN.test(raw)) return { error: 'Ad görünmez ya da kontrol karakteri içeremez.' };
  const length = visibleLength(name);
  if (length < NAME_MIN) return { error: `Ad en az ${NAME_MIN} karakter olmalı.` };
  if (length > NAME_MAX) return { error: `Ad en fazla ${NAME_MAX} karakter olabilir.` };
  return { name };
}

/** Fills in anything missing from a stored profile (older versions, partial writes). */
export function normalizeProfile(stored: Partial<Profile> | undefined): Profile {
  const fresh = newProfile();
  if (!stored) return fresh;
  const valid = typeof stored.name === 'string' && 'name' in validateName(stored.name);
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  if (!THEMES.includes(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  if (!SCHEMES.includes(settings.scheme)) settings.scheme = DEFAULT_SETTINGS.scheme;
  if (!SAVE_MODES.includes(settings.saveMode)) settings.saveMode = DEFAULT_SETTINGS.saveMode;
  if (!SCREEN_QUALITIES.includes(settings.screenQuality)) settings.screenQuality = DEFAULT_SETTINGS.screenQuality;
  if (typeof settings.screenAudio !== 'boolean') settings.screenAudio = DEFAULT_SETTINGS.screenAudio;
  return {
    name: valid ? stored.name! : fresh.name,
    deviceId: typeof stored.deviceId === 'string' && stored.deviceId ? stored.deviceId : fresh.deviceId,
    hue: typeof stored.hue === 'number' ? stored.hue : fresh.hue,
    settings,
  };
}
