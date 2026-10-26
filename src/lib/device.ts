/** This device's display identity: a chosen or random name plus its type/OS. Nothing real is exposed. */

export type DeviceKind = 'phone' | 'tablet' | 'computer';
export type DeviceOs = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'other';

export interface DeviceInfo {
  name: string;
  kind: DeviceKind;
  os: DeviceOs;
}

const KINDS: readonly DeviceKind[] = ['phone', 'tablet', 'computer'];
const OSES: readonly DeviceOs[] = ['ios', 'android', 'windows', 'macos', 'linux', 'other'];

/** Default names: a star plus a number ("Vega 27"). Neutral, short, and easy to tell apart on a list. */
const STARS = ['Vega', 'Altair', 'Orion', 'Lyra', 'Sirius', 'Rigel', 'Deneb', 'Atlas', 'Polaris', 'Nova', 'Capella', 'Antares'];

/** The playful names earlier versions generated ("Mavi Tilki"); replaced by a new default on load. */
const LEGACY_ADJECTIVES = ['Mavi', 'Kırmızı', 'Yeşil', 'Mor', 'Turuncu', 'Sarı', 'Pembe', 'Turkuaz', 'Gri', 'Lacivert', 'Altın', 'Gümüş'];
const LEGACY_ANIMALS = ['Tilki', 'Kaplan', 'Baykuş', 'Yunus', 'Kartal', 'Panda', 'Kedi', 'Ceylan', 'Kunduz', 'Penguen', 'Sincap', 'Martı'];

export function isLegacyGeneratedName(name: string): boolean {
  const [adjective, animal, ...rest] = name.split(' ');
  return rest.length === 0 && LEGACY_ADJECTIVES.includes(adjective ?? '') && LEGACY_ANIMALS.includes(animal ?? '');
}

const KIND_LABEL: Record<DeviceKind, string> = { phone: 'telefon', tablet: 'tablet', computer: 'bilgisayar' };

/** "iPhone", "iPad", "Android telefon", "Windows bilgisayar", "Mac", "Linux bilgisayar"… */
export function deviceLabel({ kind, os }: Pick<DeviceInfo, 'kind' | 'os'>): string {
  switch (os) {
    case 'ios':
      return kind === 'tablet' ? 'iPad' : 'iPhone';
    case 'macos':
      return 'Mac';
    case 'android':
      return `Android ${KIND_LABEL[kind]}`;
    case 'windows':
      return `Windows ${KIND_LABEL[kind]}`;
    case 'linux':
      return `Linux ${KIND_LABEL[kind]}`;
    default:
      return KIND_LABEL[kind];
  }
}

export function randomDeviceName(): string {
  const pick = <T,>(list: T[]) => list[crypto.getRandomValues(new Uint32Array(1))[0]! % list.length]!;
  const number = 10 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 90);
  return `${pick(STARS)} ${number}`;
}

/** iPadOS reports itself as a Mac; touch support gives it away. */
const isIpadOs = (ua: string, touchPoints: number) => /Macintosh/.test(ua) && touchPoints > 1;

export function detectDeviceKind(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): DeviceKind {
  if (/iPad|Tablet/i.test(ua) || isIpadOs(ua, touchPoints)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/iPhone|iPod|Android|Mobile/i.test(ua)) return 'phone';
  return 'computer';
}

export function detectDeviceOs(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): DeviceOs {
  if (/iPhone|iPad|iPod/i.test(ua) || isIpadOs(ua, touchPoints)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

/** Validates a kind/os pair received from another device. */
export function parseDeviceType(kind: unknown, os: unknown): Pick<DeviceInfo, 'kind' | 'os'> {
  return {
    kind: KINDS.includes(kind as DeviceKind) ? (kind as DeviceKind) : 'computer',
    os: OSES.includes(os as DeviceOs) ? (os as DeviceOs) : 'other',
  };
}

/**
 * Cleans a name received from another device: no control or bidi-override characters
 * (which could make a name read as something else), bounded length.
 */
export function cleanPeerName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').trim().slice(0, 40);
}

let self: DeviceInfo | null = null;
let selfId: string | null = null;

/** This device's identity. The name comes from the saved profile (hooks/useProfile); until it loads, a random one. */
export function selfDevice(): DeviceInfo {
  self ??= { name: randomDeviceName(), kind: detectDeviceKind(), os: detectDeviceOs() };
  return self;
}

/** Persistent random id, sent only over an established connection (never in nearby broadcasts). */
export function selfDeviceId(): string | null {
  return selfId;
}

export function setSelfIdentity(name: string, id: string): void {
  self = { ...selfDevice(), name };
  selfId = id;
}
