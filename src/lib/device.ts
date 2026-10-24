/** This device's display identity: a random friendly name plus its type/OS. Nothing real is exposed. */

export type DeviceKind = 'phone' | 'tablet' | 'computer';
export type DeviceOs = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'other';

export interface DeviceInfo {
  name: string;
  kind: DeviceKind;
  os: DeviceOs;
}

const KINDS: readonly DeviceKind[] = ['phone', 'tablet', 'computer'];
const OSES: readonly DeviceOs[] = ['ios', 'android', 'windows', 'macos', 'linux', 'other'];

const ADJECTIVES = ['Mavi', 'Kırmızı', 'Yeşil', 'Mor', 'Turuncu', 'Sarı', 'Pembe', 'Turkuaz', 'Gri', 'Lacivert', 'Altın', 'Gümüş'];
const ANIMALS = ['Tilki', 'Kaplan', 'Baykuş', 'Yunus', 'Kartal', 'Panda', 'Kedi', 'Ceylan', 'Kunduz', 'Penguen', 'Sincap', 'Martı'];

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
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
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

let self: DeviceInfo | null = null;

/** Stable for this tab (survives reloads via sessionStorage, never shared across tabs or persisted). */
export function selfDevice(): DeviceInfo {
  if (self) return self;
  let name: string | null = null;
  try {
    name = sessionStorage.getItem('theshare-name');
    if (!name) {
      name = randomDeviceName();
      sessionStorage.setItem('theshare-name', name);
    }
  } catch {
    name ??= randomDeviceName();
  }
  self = { name, kind: detectDeviceKind(), os: detectDeviceOs() };
  return self;
}
