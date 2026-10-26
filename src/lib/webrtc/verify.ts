/**
 * Security code (SAS) for a connection: the same 12 digits on both screens
 * mean both devices hold the DTLS certificates they think they hold, so nobody
 * swapped the offer/answer in transit.
 *
 * A digest of the two fingerprints alone is not enough: device certificates
 * are persistent (lib/webrtc/identity), so an attacker in the middle knows
 * both fingerprints in advance and can search for two certificates of their
 * own whose digests collide (a birthday search, ~2^20 tries for 40 bits).
 * So each side also contributes a fresh random nonce, exchanged over the
 * already-encrypted channel with a commit/reveal step (as in ZRTP):
 *
 *   A ──▶ commit H(fp_A, n_A)        B ──▶ commit H(fp_B, n_B)
 *   on the other's commit:  reveal n_A / reveal n_B
 *   code = H(sorted fingerprints, sorted nonces) → 40 bits → 12 digits
 *
 * Nobody reveals before holding the other side's commitment, so an attacker
 * running two connections fixes its own nonces before learning the honest
 * ones: each attempt matches with probability 2^-40, and a failed attempt
 * shows as different codes.
 */

const COMMIT_LABEL = 'theshare/sas-commit/v1';
const CODE_LABEL = 'theshare/sas/v1';
const NONCE_BYTES = 32;
const HEX_64 = /^[0-9a-f]{64}$/;

export type SasMessage = { t: 'sas-commit'; c: string } | { t: 'sas-reveal'; n: string };

export const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX_64.test(v);

const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(...parts: string[]): Promise<Uint8Array> {
  const input = new TextEncoder().encode(parts.join('|'));
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

export function newNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/** What a side sends first: binds its nonce (and its own fingerprint) before seeing the other's. */
export async function commitment(fingerprint: string, nonce: string): Promise<string> {
  return toHex(await sha256(COMMIT_LABEL, fingerprint, nonce));
}

/** "482 913 076 551": 40 bits of the transcript, as four groups of three digits. */
export async function securityCode(fingerprints: [string, string], nonces: [string, string]): Promise<string> {
  const digest = await sha256(CODE_LABEL, ...[...fingerprints].sort(), ...[...nonces].sort());
  // 48 bits mod 10^12: no value is more than 2^-8 likelier than another.
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i]!;
  const digits = (n % 1e12).toString().padStart(12, '0');
  return digits.match(/\d{3}/g)!.join(' ');
}

/**
 * One side of the exchange. `start()` sends our commitment; feed every
 * incoming SasMessage to `handle()`. Ends with `onCode` (the code to show) or
 * `onFail` (the other side broke the protocol or its reveal didn't match its
 * commitment: the connection must not be trusted).
 */
export class SasExchange {
  onCode: (code: string) => void = () => {};
  onFail: () => void = () => {};

  private readonly nonce = newNonce();
  private committed = false;
  private theirCommit: string | null = null;
  private revealed = false;
  private done = false;

  constructor(
    private readonly localFingerprint: string,
    private readonly remoteFingerprint: string,
    private readonly send: (msg: SasMessage) => void,
  ) {}

  async start(): Promise<void> {
    this.send({ t: 'sas-commit', c: await commitment(this.localFingerprint, this.nonce) });
    this.committed = true;
    this.revealIfReady();
  }

  async handle(msg: SasMessage): Promise<void> {
    if (this.done) return;
    if (msg.t === 'sas-commit') {
      // Only the first commitment counts; a later one could be chosen after seeing our nonce.
      if (this.theirCommit === null) {
        this.theirCommit = msg.c;
        this.revealIfReady();
      }
      return;
    }
    this.done = true;
    // The channel is ordered and they reveal only after our commitment, by which
    // time we hold theirs and have revealed too. Anything else is not our protocol.
    if (this.theirCommit === null || !this.revealed) return this.onFail();
    if ((await commitment(this.remoteFingerprint, msg.n)) !== this.theirCommit) return this.onFail();
    this.onCode(await securityCode([this.localFingerprint, this.remoteFingerprint], [this.nonce, msg.n]));
  }

  private revealIfReady(): void {
    if (this.revealed || !this.committed || this.theirCommit === null) return;
    this.revealed = true;
    this.send({ t: 'sas-reveal', n: this.nonce });
  }
}
