import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from '../../src/lib/qr/base45';
import { FountainDecoder, FountainEncoder, decodeFrame, encodeFrame } from '../../src/lib/qr/fountain';
import { AIR_PRESETS, AirError, AirReceiver, packAir, unpackAir } from '../../src/lib/qr/airgap';
import { encodeQr } from '../../src/lib/qr/generate';

const random = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
};

/** Deterministic PRNG for the loss simulation, so a failure is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
}

/** Plays the sender's stream from `start`, dropping `loss` of the frames; returns frames shown until done. */
function simulate(data: Uint8Array, blockSize: number, { loss = 0, start = 0, seed = 1 } = {}) {
  const enc = new FountainEncoder(data, blockSize);
  const rx = new AirReceiver();
  const rand = rng(seed);
  let n = start;
  for (; n < start + enc.k * 10; n++) {
    if (rand() < loss) continue;
    rx.feed(enc.frame(n));
    if (rx.decoder?.done) break;
  }
  expect(rx.decoder?.done).toBe(true);
  expect(rx.decoder!.result()).toEqual(data);
  return { shown: n - start + 1, k: enc.k };
}

describe('base45', () => {
  it('matches the RFC 9285 examples', () => {
    expect(encodeBase45(new TextEncoder().encode('AB'))).toBe('BB8');
    expect(encodeBase45(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(encodeBase45(new TextEncoder().encode('ietf!'))).toBe('QED8WEX0');
    expect(new TextDecoder().decode(decodeBase45('QED8WEX0')!)).toBe('ietf!');
  });

  it('round-trips arbitrary bytes, odd and even lengths', () => {
    for (const n of [0, 1, 2, 3, 255, 256, 1001]) {
      const bytes = random(n);
      expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
    }
  });

  it('rejects invalid input', () => {
    expect(decodeBase45('a')).toBeNull();
    expect(decodeBase45('GGW')).toBeNull(); // 65535 < value
    expect(decodeBase45('abc')).toBeNull(); // lowercase isn't in the alphabet
  });
});

describe('fountain frames', () => {
  it('round-trips a frame and rejects foreign QR codes', () => {
    const frame = { sid: 0xdeadbeef, length: 1234, blockSize: 4, id: 77, data: new Uint8Array([1, 2, 3, 4]) };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
    expect(decodeFrame('https://example.com')).toBeNull();
    expect(decodeFrame('TS1.abc')).toBeNull();
    expect(decodeFrame('TSQ:' + encodeBase45(new Uint8Array(20)))).toBeNull(); // version 0
  });

  it('frames use only QR alphanumeric characters and fit a scannable QR', () => {
    for (const preset of Object.values(AIR_PRESETS)) {
      const text = new FountainEncoder(random(5000), preset.blockSize).frame(9);
      expect(text).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
      // version ≤ 19 (93 modules + quiet zone): still readable off a phone screen
      expect(encodeQr(text, 'L')!.size).toBeLessThanOrEqual(97);
    }
  });

  it('decodes from the plain blocks alone', () => {
    const { shown, k } = simulate(random(10_000), 400);
    expect(shown).toBe(k);
  });

  it('decodes with 25% of the frames missed', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { shown, k } = simulate(random(40_000), 400, { loss: 0.25, seed });
      expect(shown / k).toBeLessThan(1.7); // ideal: 1 / (1 - loss) = 1.33
    }
  });

  it('decodes when the camera starts long after the plain blocks went by', () => {
    for (const seed of [1, 2, 3]) {
      const { shown, k } = simulate(random(40_000), 400, { loss: 0.1, start: 500, seed });
      expect(shown / k).toBeLessThan(1.35);
    }
  });

  it('handles a single block and a tiny payload', () => {
    expect(simulate(new Uint8Array([42]), 400, { start: 7 }).shown).toBe(1);
    simulate(random(401), 400, { loss: 0.3, start: 3 });
  });

  it('ignores duplicates and starts over on a new stream', () => {
    const rx = new AirReceiver();
    const a = new FountainEncoder(random(2000), 100);
    const b = new FountainEncoder(random(2000), 100);
    expect(rx.feed('hello')).toBe('ignored');
    expect(rx.feed(a.frame(0))).toBe('progress');
    expect(rx.feed(a.frame(0))).toBe('duplicate');
    expect(rx.feed(b.frame(0))).toBe('restarted');
    expect(rx.decoder!.received).toBe(1);
  });

  it('a decoder rejects symbols after it is done', () => {
    const enc = new FountainEncoder(random(300), 100);
    const dec = new FountainDecoder(enc.header);
    for (let i = 0; i < 3; i++) dec.add(i, enc.symbol(i));
    expect(dec.done).toBe(true);
    expect(dec.add(10, enc.symbol(10))).toBe(false);
  });
});

describe('air payload', () => {
  it('round-trips a file and a text, compressing what compresses', async () => {
    const text = 'merhaba dünya '.repeat(500);
    const packed = await packAir({ kind: 'text', name: '', bytes: new TextEncoder().encode(text) });
    expect(packed.length).toBeLessThan(500);
    const out = await unpackAir(packed);
    expect(out.kind).toBe('text');
    expect(new TextDecoder().decode(out.bytes)).toBe(text);

    const bytes = random(3000);
    const file = await unpackAir(await packAir({ kind: 'file', name: '../gizli/rapor.pdf', bytes }));
    expect(file).toEqual({ kind: 'file', name: '_gizli_rapor.pdf', bytes });
  });

  it('rejects corrupted data', async () => {
    const packed = await packAir({ kind: 'file', name: 'a.bin', bytes: random(500) });
    packed[packed.length - 1]! ^= 1;
    await expect(unpackAir(packed)).rejects.toBeInstanceOf(AirError);
    await expect(unpackAir(new Uint8Array([0, 0, 2, 123, 125]))).rejects.toBeInstanceOf(AirError);
  });
});
