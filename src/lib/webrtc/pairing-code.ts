import { sdpFingerprint } from './signal-codec';

/**
 * Short code derived from both DTLS certificate fingerprints. If the two
 * screens show the same code, both devices are talking to each other and not
 * to someone who swapped the offer/answer in transit (relevant when the codes
 * travel through a messenger instead of a QR scan).
 *
 * This is not a new crypto protocol: it only displays a digest of the
 * fingerprints WebRTC already verifies during the DTLS handshake.
 */
export async function pairingCode(localSdp: string, remoteSdp: string): Promise<string | null> {
  const a = sdpFingerprint(localSdp);
  const b = sdpFingerprint(remoteSdp);
  if (!a || !b || !globalThis.crypto?.subtle) return null;
  const input = new TextEncoder().encode([a, b].sort().join('|'));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  const n = ((digest[0]! << 16) | (digest[1]! << 8) | digest[2]!) % 1_000_000;
  const s = n.toString().padStart(6, '0');
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
