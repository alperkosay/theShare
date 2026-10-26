import { describe, expect, it } from 'vitest';
import { commitment, newNonce, SasExchange, securityCode, type SasMessage } from '../../src/lib/webrtc/verify';

const FP_A = Array(32).fill('AA').join(':');
const FP_B = Array(32).fill('BB').join(':');
const FP_M = Array(32).fill('CC').join(':');

/** Two exchanges wired back to back; messages are delivered in order, one hop at a time. */
function pair(localA: string, remoteA: string, localB: string, remoteB: string) {
  const toB: SasMessage[] = [];
  const toA: SasMessage[] = [];
  const a = new SasExchange(localA, remoteA, (m) => toB.push(m));
  const b = new SasExchange(localB, remoteB, (m) => toA.push(m));
  const result = { a: null as string | null, b: null as string | null, failA: false, failB: false };
  a.onCode = (c) => (result.a = c);
  b.onCode = (c) => (result.b = c);
  a.onFail = () => (result.failA = true);
  b.onFail = () => (result.failB = true);
  const run = async () => {
    await Promise.all([a.start(), b.start()]);
    while (toA.length || toB.length) {
      const forB = toB.splice(0);
      const forA = toA.splice(0);
      for (const m of forB) await b.handle(m);
      for (const m of forA) await a.handle(m);
    }
    return result;
  };
  return { a, b, toA, toB, run };
}

describe('securityCode', () => {
  it('is 12 digits in four groups, independent of order', async () => {
    const [n1, n2] = [newNonce(), newNonce()];
    const code = await securityCode([FP_A, FP_B], [n1, n2]);
    expect(code).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(await securityCode([FP_B, FP_A], [n2, n1])).toBe(code);
  });

  it('changes with either nonce or fingerprint', async () => {
    const [n1, n2] = [newNonce(), newNonce()];
    const code = await securityCode([FP_A, FP_B], [n1, n2]);
    expect(await securityCode([FP_A, FP_B], [n1, newNonce()])).not.toBe(code);
    expect(await securityCode([FP_A, FP_M], [n1, n2])).not.toBe(code);
  });
});

describe('SasExchange', () => {
  it('both sides of a direct connection get the same code', async () => {
    const result = await pair(FP_A, FP_B, FP_B, FP_A).run();
    expect(result.failA || result.failB).toBe(false);
    expect(result.a).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
    expect(result.a).toBe(result.b);
  });

  it('a fresh code every connection, even between the same certificates', async () => {
    const first = await pair(FP_A, FP_B, FP_B, FP_A).run();
    const second = await pair(FP_A, FP_B, FP_B, FP_A).run();
    expect(first.a).not.toBe(second.a);
  });

  it('someone in the middle ends up with different codes on the two screens', async () => {
    // A ↔ M and M ↔ B are two separate connections with M's certificate on both.
    const left = await pair(FP_A, FP_M, FP_M, FP_A).run();
    const right = await pair(FP_M, FP_B, FP_B, FP_M).run();
    expect(left.a).not.toBe(right.b);
  });

  it('fails when the reveal does not match the commitment', async () => {
    const exchange = new SasExchange(FP_A, FP_B, () => {});
    let failed = false;
    exchange.onFail = () => (failed = true);
    await exchange.start();
    await exchange.handle({ t: 'sas-commit', c: await commitment(FP_B, newNonce()) });
    await exchange.handle({ t: 'sas-reveal', n: newNonce() });
    expect(failed).toBe(true);
  });

  it('fails on a reveal that arrives before the commitment', async () => {
    const exchange = new SasExchange(FP_A, FP_B, () => {});
    let failed = false;
    exchange.onFail = () => (failed = true);
    await exchange.start();
    await exchange.handle({ t: 'sas-reveal', n: newNonce() });
    expect(failed).toBe(true);
  });

  it('does not reveal before it holds the other commitment, and ignores a second commitment', async () => {
    const sent: SasMessage[] = [];
    const exchange = new SasExchange(FP_A, FP_B, (m) => sent.push(m));
    await exchange.start();
    expect(sent.map((m) => m.t)).toEqual(['sas-commit']);

    const nonce = newNonce();
    await exchange.handle({ t: 'sas-commit', c: await commitment(FP_B, nonce) });
    expect(sent.map((m) => m.t)).toEqual(['sas-commit', 'sas-reveal']);

    // A commitment chosen after seeing our nonce doesn't replace the first one.
    let code: string | null = null;
    let failed = false;
    exchange.onCode = (c) => (code = c);
    exchange.onFail = () => (failed = true);
    await exchange.handle({ t: 'sas-commit', c: await commitment(FP_B, newNonce()) });
    await exchange.handle({ t: 'sas-reveal', n: nonce });
    expect(failed).toBe(false);
    expect(code).toMatch(/^\d{3} \d{3} \d{3} \d{3}$/);
  });
});
