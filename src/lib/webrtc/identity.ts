import { dbGet, dbPut } from '../storage/db';

/**
 * This device's DTLS certificate, made once and kept in IndexedDB. Every
 * connection uses it, so the fingerprint the other side's WebRTC verifies is
 * the same each time: that fingerprint is the device's real identity (the id
 * in the hello is only a claim). The private key can't be read out of an
 * RTCCertificate, not even by this page.
 *
 * Without storage (some private modes) a certificate is made for this visit
 * only: connections still work, but nobody can remember this device.
 */

const CERT_KEY = 'certificate';
const LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
/** Renewed this long before it expires, so a connection never starts on a dying certificate. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;
const LOAD_TIMEOUT_MS = 1500;

let current: RTCCertificate | null = null;
let loading: Promise<void> | null = null;

const usable = (cert: RTCCertificate | null | undefined): cert is RTCCertificate =>
  !!cert && cert.expires - Date.now() > RENEW_BEFORE_MS;

/** Loads or makes the certificate. Safe to call again (e.g. after "reset everything"). */
export function loadDeviceCertificate(): Promise<void> {
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

async function load(): Promise<void> {
  if (typeof RTCPeerConnection === 'undefined') return;
  const stored = await Promise.race([
    dbGet<RTCCertificate>('profile', CERT_KEY).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS)),
  ]);
  if (usable(stored)) {
    current = stored;
    return;
  }
  try {
    // `expires` is part of the WebRTC spec's keygen dictionary but missing from TypeScript's DOM types.
    const cert = await RTCPeerConnection.generateCertificate({ name: 'ECDSA', namedCurve: 'P-256', expires: LIFETIME_MS } as EcKeyGenParams);
    current = cert;
    await dbPut('profile', cert, CERT_KEY);
  } catch {
    // Not storable here: the certificate (if made) lasts for this visit.
  }
}

/** The certificate for a new connection, or null to let the browser make a throwaway one. */
export function deviceCertificate(): RTCCertificate | null {
  return current && current.expires > Date.now() ? current : null;
}

/** "Reset everything" deleted the database: the next load makes a new identity. */
export function forgetDeviceCertificate(): void {
  current = null;
}
