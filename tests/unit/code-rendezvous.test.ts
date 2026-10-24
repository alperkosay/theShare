import { describe, expect, it } from 'vitest';
import { formatCode, generateCode, normalizeCode } from '../../src/lib/signaling/code-rendezvous';
import { deriveRoom, seal, unseal } from '../../src/lib/signaling/tracker';

describe('pairing codes', () => {
  it('generates 6-digit codes', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('normalizes user input', () => {
    expect(normalizeCode('482 913')).toBe('482913');
    expect(normalizeCode(' 482-913 ')).toBe('482913');
    expect(normalizeCode('48291')).toBeNull();
    expect(normalizeCode('4829134')).toBeNull();
    expect(normalizeCode('48a913')).toBeNull();
    expect(formatCode('482913')).toBe('482 913');
  });
});

describe('room derivation and sealing', () => {
  it('derives the same room for the same code and a different one otherwise', async () => {
    const [a, b, c] = await Promise.all([deriveRoom('123456'), deriveRoom('123456'), deriveRoom('123457')]);
    expect(a.infoHash).toMatch(/^[0-9a-f]{20}$/);
    expect(a.infoHash).toBe(b.infoHash);
    expect(a.infoHash).not.toBe(c.infoHash);
  });

  it('round-trips sealed payloads and rejects foreign or tampered ones', async () => {
    const [{ key }, { key: other }] = await Promise.all([deriveRoom('111111'), deriveRoom('222222')]);
    const sealed = await seal(key, 'TS1.example');
    expect(await unseal(key, sealed)).toBe('TS1.example');
    expect(await unseal(other, sealed)).toBeNull();
    expect(await unseal(key, sealed.slice(0, -4) + 'AAAA')).toBeNull();
    expect(await unseal(key, 42)).toBeNull();
    expect(await unseal(key, 'not base64!')).toBeNull();
  });
});
