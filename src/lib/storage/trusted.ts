import { cleanPeerName, parseDeviceType, type DeviceKind, type DeviceOs } from '../device';

/**
 * Devices this one has verified, keyed by their DTLS certificate fingerprint
 * (lib/webrtc/identity): a later connection presenting the same fingerprint is
 * the same device, whatever name or id it claims. Kept only on this device.
 */
export interface TrustedDevice {
  fingerprint: string;
  /** The persistent id it claimed in its hello, to notice when that id shows up with another certificate. */
  id?: string;
  name: string;
  kind: DeviceKind;
  os: DeviceOs;
  addedAt: number;
  lastSeen: number;
}

export interface PeerClaim {
  id?: string;
  name: string;
  kind: DeviceKind;
  os: DeviceOs;
}

export const MAX_TRUSTED = 200;

/**
 * What a new connection's fingerprint and hello mean against the list:
 *  known    same certificate as a verified device
 *  changed  claims the id of a verified device but brings another certificate:
 *           that device was reset or renewed its certificate, or someone pretends to be it
 *  new      never verified; `sameName` when a verified device uses this name
 */
export type TrustJudgement =
  | { kind: 'known'; device: TrustedDevice }
  | { kind: 'changed'; device: TrustedDevice }
  | { kind: 'new'; sameName?: TrustedDevice };

const FINGERPRINT_RE = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function judgeTrust(list: readonly TrustedDevice[], fingerprint: string, claim: PeerClaim | null): TrustJudgement {
  const known = list.find((d) => d.fingerprint === fingerprint);
  if (known) return { kind: 'known', device: known };
  const sameId = claim?.id ? list.find((d) => d.id === claim.id) : undefined;
  if (sameId) return { kind: 'changed', device: sameId };
  const sameName = claim ? list.find((d) => d.name === claim.name) : undefined;
  return sameName ? { kind: 'new', sameName } : { kind: 'new' };
}

/**
 * Adds or refreshes a device. A verified device that claims an id held by an
 * older entry replaces it (the device renewed its certificate). Oldest-seen
 * entries go first beyond MAX_TRUSTED.
 */
export function upsertTrusted(list: readonly TrustedDevice[], fingerprint: string, claim: PeerClaim | null, now = Date.now()): TrustedDevice[] {
  const existing = list.find((d) => d.fingerprint === fingerprint);
  const device: TrustedDevice = {
    fingerprint,
    name: claim?.name ?? existing?.name ?? 'Cihaz',
    kind: claim?.kind ?? existing?.kind ?? 'computer',
    os: claim?.os ?? existing?.os ?? 'other',
    addedAt: existing?.addedAt ?? now,
    lastSeen: now,
    ...(claim?.id ? { id: claim.id } : existing?.id ? { id: existing.id } : {}),
  };
  const rest = list.filter((d) => d.fingerprint !== fingerprint && !(device.id && d.id === device.id));
  return [device, ...rest].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, MAX_TRUSTED);
}

/** Validates the stored list (older versions, partial writes). */
export function parseTrusted(stored: unknown): TrustedDevice[] {
  if (!Array.isArray(stored)) return [];
  const out: TrustedDevice[] = [];
  for (const v of stored) {
    if (typeof v !== 'object' || v === null) continue;
    const d = v as Record<string, unknown>;
    if (typeof d.fingerprint !== 'string' || !FINGERPRINT_RE.test(d.fingerprint)) continue;
    const time = (t: unknown) => (typeof t === 'number' && Number.isFinite(t) ? t : 0);
    out.push({
      fingerprint: d.fingerprint,
      name: cleanPeerName(d.name) || 'Cihaz',
      ...parseDeviceType(d.kind, d.os),
      addedAt: time(d.addedAt),
      lastSeen: time(d.lastSeen),
      ...(typeof d.id === 'string' && d.id ? { id: d.id } : {}),
    });
  }
  return out.slice(0, MAX_TRUSTED);
}
