import { describe, expect, it } from 'vitest';
import { expiredEntries, filterHistory, groupByDay, peerTotals, planCopy, type HistoryEntry } from '../../src/lib/storage/history';
import { sniffMedia } from '../../src/lib/preview';

const MB = 1024 * 1024;

function entry(patch: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: Math.random().toString(36).slice(2),
    at: Date.now(),
    direction: 'out',
    kind: 'files',
    files: [{ name: 'rapor.pdf', size: 2_400_000, type: 'application/pdf' }],
    totalBytes: 2_400_000,
    status: 'done',
    peer: { name: 'Yeşil Panda', kind: 'computer', os: 'windows' },
    method: 'nearby',
    ...patch,
  };
}

describe('grouping by day', () => {
  const now = new Date(2026, 9, 25, 14, 32).getTime();
  const at = (d: number, h = 10) => new Date(2026, 9, d, h).getTime();

  it('labels today, yesterday, then dates', () => {
    const groups = groupByDay([entry({ at: at(25, 9) }), entry({ at: at(25, 1) }), entry({ at: at(24, 23) }), entry({ at: at(20) })], now);
    expect(groups.map((g) => g.label)).toEqual(['Bugün', 'Dün', '20 Ekim']);
    expect(groups[0]!.entries).toHaveLength(2);
  });

  it('adds the year for earlier years', () => {
    const [group] = groupByDay([entry({ at: new Date(2025, 0, 3).getTime() })], now);
    expect(group!.label).toBe('3 Ocak 2025');
  });
});

describe('filtering', () => {
  const list = [
    entry({ direction: 'out', files: [{ name: 'Rapor.pdf', size: 1, type: '' }] }),
    entry({ direction: 'in', files: [{ name: 'tatil.jpg', size: 1, type: '' }], peer: { name: 'İpek', kind: 'phone', os: 'ios' } }),
    entry({ direction: 'in', kind: 'text', textPreview: 'şifre değil', files: undefined }),
  ];

  it('filters by direction', () => {
    expect(filterHistory(list, 'out', '')).toHaveLength(1);
    expect(filterHistory(list, 'in', '')).toHaveLength(2);
    expect(filterHistory(list, 'all', '')).toHaveLength(3);
  });

  it('searches names, devices and text case-insensitively (Turkish İ/i)', () => {
    expect(filterHistory(list, 'all', 'rapor')).toHaveLength(1);
    expect(filterHistory(list, 'all', 'ipek')).toHaveLength(1);
    expect(filterHistory(list, 'all', 'ŞİFRE')).toHaveLength(1);
    expect(filterHistory(list, 'out', 'tatil')).toHaveLength(0);
  });
});

describe('retention', () => {
  it('expires entries older than the limit, never with "forever"', () => {
    const now = Date.now();
    const old = entry({ at: now - 91 * 24 * 3600_000 });
    const fresh = entry({ at: now - 89 * 24 * 3600_000 });
    expect(expiredEntries([old, fresh], 90, now)).toEqual([old]);
    expect(expiredEntries([old, fresh], null, now)).toEqual([]);
  });
});

describe('copy quota', () => {
  it('keeps a copy when there is room', () => {
    expect(planCopy([{ key: 'a', at: 1, bytes: 100 * MB }], [{ size: 10 * MB }], 1024 * MB)).toEqual({ evict: [] });
  });

  it('evicts the oldest copies until the new one fits', () => {
    const existing = [
      { key: 'new', at: 3, bytes: 300 * MB },
      { key: 'oldest', at: 1, bytes: 300 * MB },
      { key: 'old', at: 2, bytes: 300 * MB },
    ];
    expect(planCopy(existing, [{ size: 300 * MB }], 1024 * MB)).toEqual({ evict: ['oldest'] });
    expect(planCopy(existing, [{ size: 300 * MB }, { size: 300 * MB }], 1024 * MB)).toEqual({ evict: ['oldest', 'old'] });
  });

  it('refuses files over the per-file limit or over the total', () => {
    expect(planCopy([], [{ size: 501 * MB }])).toBeNull();
    expect(planCopy([], [{ size: 400 * MB }, { size: 400 * MB }], 512 * MB)).toBeNull();
  });
});

describe('per-device totals', () => {
  it('counts finished files by persistent device id', () => {
    const peer = { id: 'dev-1', name: 'Alper', kind: 'phone' as const, os: 'ios' as const };
    const list = [
      entry({ peer, files: [{ name: 'a', size: 1, type: '' }, { name: 'b', size: 1, type: '' }] }),
      entry({ peer, direction: 'in' }),
      entry({ peer, status: 'failed' }),
      entry({}),
    ];
    expect(peerTotals(list, 'dev-1')).toEqual({ sent: 2, received: 1 });
  });
});

describe('preview sniffing', () => {
  const bytes = (...parts: Array<number[] | string>) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)).concat(Array(16).fill(0)));

  it('recognises images and videos by content', () => {
    expect(sniffMedia(bytes([0x89], 'PNG'))).toEqual({ kind: 'image', type: 'image/png' });
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff]))).toEqual({ kind: 'image', type: 'image/jpeg' });
    expect(sniffMedia(bytes('GIF89a'))?.type).toBe('image/gif');
    expect(sniffMedia(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))?.type).toBe('image/webp');
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftypavif'))?.type).toBe('image/avif');
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftypisom'))).toEqual({ kind: 'video', type: 'video/mp4' });
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.kind).toBe('video');
  });

  it('never previews SVG, HTML, HEIC or unknown data', () => {
    expect(sniffMedia(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffMedia(bytes('<!doctype html>'))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBeNull();
    expect(sniffMedia(bytes('hello world'))).toBeNull();
  });
});
