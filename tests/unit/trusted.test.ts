import { describe, expect, it } from 'vitest';
import { judgeTrust, MAX_TRUSTED, parseTrusted, upsertTrusted, type PeerClaim } from '../../src/lib/storage/trusted';

const fp = (byte: string) => Array(32).fill(byte).join(':');
const laptop: PeerClaim = { id: 'dev-1', name: 'Vega 27', kind: 'computer', os: 'windows' };

describe('trusted devices', () => {
  it('recognises a verified certificate whatever the device claims', () => {
    const list = upsertTrusted([], fp('AA'), laptop);
    expect(judgeTrust(list, fp('AA'), null).kind).toBe('known');
    expect(judgeTrust(list, fp('AA'), { ...laptop, id: 'other', name: 'Başka' }).kind).toBe('known');
  });

  it('flags a trusted id that comes with another certificate', () => {
    const list = upsertTrusted([], fp('AA'), laptop);
    const judgement = judgeTrust(list, fp('BB'), laptop);
    expect(judgement.kind).toBe('changed');
    expect(judgement.kind === 'changed' && judgement.device.name).toBe('Vega 27');
  });

  it('only notes a trusted name on an unknown device (names are not unique)', () => {
    const list = upsertTrusted([], fp('AA'), laptop);
    const judgement = judgeTrust(list, fp('BB'), { ...laptop, id: 'dev-2' });
    expect(judgement).toEqual({ kind: 'new', sameName: list[0] });
    expect(judgeTrust(list, fp('BB'), null)).toEqual({ kind: 'new' });
  });

  it('a renewed certificate replaces the entry with the same id', () => {
    let list = upsertTrusted([], fp('AA'), laptop, 1);
    list = upsertTrusted(list, fp('BB'), laptop, 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ fingerprint: fp('BB'), id: 'dev-1', lastSeen: 2 });
  });

  it('refreshing keeps when it was added and the name it already had', () => {
    let list = upsertTrusted([], fp('AA'), laptop, 1);
    list = upsertTrusted(list, fp('AA'), null, 5);
    expect(list[0]).toMatchObject({ name: 'Vega 27', id: 'dev-1', addedAt: 1, lastSeen: 5 });
  });

  it('keeps the most recently seen when full', () => {
    const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    const nth = (i: number) => [...Array(30).fill('00'), hex(i >> 8), hex(i & 255)].join(':');
    let list = upsertTrusted([], nth(0), { name: 'eski', kind: 'phone', os: 'ios' }, 0);
    for (let i = 1; i <= MAX_TRUSTED; i++) list = upsertTrusted(list, nth(i), { name: `d${i}`, kind: 'phone', os: 'ios' }, i);
    expect(list).toHaveLength(MAX_TRUSTED);
    expect(list.some((d) => d.name === 'eski')).toBe(false);
  });

  it('drops malformed stored entries and cleans names', () => {
    const parsed = parseTrusted([
      { fingerprint: fp('AA'), name: 'Vega‮ 27', kind: 'phone', os: 'android', addedAt: 1, lastSeen: 2 },
      { fingerprint: 'not a fingerprint', name: 'x' },
      { fingerprint: fp('ab'), name: 'lowercase' },
      null,
      'x',
    ]);
    expect(parsed).toEqual([{ fingerprint: fp('AA'), name: 'Vega 27', kind: 'phone', os: 'android', addedAt: 1, lastSeen: 2 }]);
    expect(parseTrusted(undefined)).toEqual([]);
  });
});
