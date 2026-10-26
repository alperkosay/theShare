import { describe, expect, it } from 'vitest';
import { ristretto255 } from '@noble/curves/ed25519.js';
import { pakeFinish, pakeStart } from '../../src/lib/signaling/pake';
import { seal, unseal } from '../../src/lib/signaling/tracker';

const CHANNEL = 'test';

async function run(passwordA: string, passwordB: string, sidA = 'sid-1', sidB = sidA) {
  const a = pakeStart(passwordA, CHANNEL, sidA, 'initiator');
  const b = pakeStart(passwordB, CHANNEL, sidB, 'responder');
  return { a, b, ka: (await pakeFinish(a, b.share))!, kb: (await pakeFinish(b, a.share))! };
}

describe('CPace', () => {
  it('the same code gives both sides the same key and matching confirmations', async () => {
    const { ka, kb } = await run('482913', '482913');
    expect(await kb.check(ka.tag)).toBe(true);
    expect(await ka.check(kb.tag)).toBe(true);
    expect(await unseal(kb.key, await seal(ka.key, 'TS1.offer'))).toBe('TS1.offer');
  });

  it('a confirmation only counts for the other role', async () => {
    const { ka, kb } = await run('482913', '482913');
    expect(ka.tag).not.toBe(kb.tag);
    expect(await ka.check(ka.tag)).toBe(false);
  });

  it('a different code (or session id) gives a different key', async () => {
    for (const { ka, kb } of [await run('482913', '482914'), await run('482913', '482913', 'sid-1', 'sid-2')]) {
      expect(await kb.check(ka.tag)).toBe(false);
      expect(await unseal(kb.key, await seal(ka.key, 'TS1.offer'))).toBeNull();
    }
  });

  it('shares look random: fresh every run, nothing in them depends only on the code', () => {
    const shares = new Set(Array.from({ length: 5 }, () => pakeStart('482913', CHANNEL, 'sid', 'initiator').share));
    expect(shares.size).toBe(5);
    for (const s of shares) expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid shares, the identity and a reflected share', async () => {
    const side = pakeStart('482913', CHANNEL, 'sid', 'responder');
    const identity = Buffer.from(ristretto255.Point.ZERO.toBytes()).toString('hex');
    for (const bad of [identity, 'ff'.repeat(32), 'zz', 42, null, side.share]) {
      expect(await pakeFinish(side, bad), String(bad)).toBeNull();
    }
  });

  it('rejects malformed confirmations', async () => {
    const { ka } = await run('482913', '482913');
    for (const bad of [undefined, '', 'ab', 'AB'.repeat(32), 7]) expect(await ka.check(bad)).toBe(false);
  });
});
