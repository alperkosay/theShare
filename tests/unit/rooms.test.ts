import { describe, expect, it } from 'vitest';
import { addRoom, liveRooms, MAX_ROOMS, ROOM_TTL_MS, type RecentRoom } from '../../src/lib/storage/rooms';
import { resolveSaveMode, shareType } from '../../src/lib/transfer/save';

describe('recent rooms', () => {
  const now = 1_800_000_000_000;

  it('keeps the newest rooms first and refreshes a reused code', () => {
    let list: RecentRoom[] = [];
    list = addRoom(list, { code: '111111', role: 'host', at: now - 3000 }, now);
    list = addRoom(list, { code: '222222', role: 'join', at: now - 2000 }, now);
    list = addRoom(list, { code: '111111', role: 'host', at: now - 1000 }, now);
    expect(list.map((r) => r.code)).toEqual(['111111', '222222']);
    expect(list[0]!.at).toBe(now - 1000);
  });

  it('the latest role wins for the same code', () => {
    const list = addRoom([{ code: '111111', role: 'host', at: now - 1000 }], { code: '111111', role: 'join', at: now }, now);
    expect(list).toEqual([{ code: '111111', role: 'join', at: now }]);
  });

  it(`keeps at most ${MAX_ROOMS}`, () => {
    let list: RecentRoom[] = [];
    for (let i = 0; i < 6; i++) list = addRoom(list, { code: String(100000 + i), role: 'host', at: now - 10 + i }, now);
    expect(list).toHaveLength(MAX_ROOMS);
    expect(list[0]!.code).toBe('100005');
  });

  it('drops expired, future-dated and malformed rooms', () => {
    const list = liveRooms(
      [
        { code: '111111', role: 'host', at: now - ROOM_TTL_MS - 1 },
        { code: '222222', role: 'join', at: now + 60_000 },
        { code: '12345', role: 'host', at: now },
        { code: '333333', role: 'admin' as never, at: now },
        { code: '444444', role: 'join', at: now - 5 },
      ],
      now,
    );
    expect(list.map((r) => r.code)).toEqual(['444444']);
  });
});

describe('save mode', () => {
  it('auto shares on iOS (when the browser can) and downloads elsewhere', () => {
    expect(resolveSaveMode('auto', false, 'ios', true, false)).toBe('share');
    expect(resolveSaveMode('auto', false, 'ios', false, false)).toBe('download');
    expect(resolveSaveMode('auto', false, 'android', true, false)).toBe('download');
    expect(resolveSaveMode('auto', false, 'windows', true, true)).toBe('download');
  });

  it('falls back to auto when the chosen way is not available', () => {
    expect(resolveSaveMode('folder', true, 'windows', false, true)).toBe('folder');
    expect(resolveSaveMode('folder', false, 'windows', false, true)).toBe('download');
    expect(resolveSaveMode('folder', true, 'ios', true, false)).toBe('share');
    expect(resolveSaveMode('share', false, 'linux', false, false)).toBe('download');
    expect(resolveSaveMode('download', false, 'ios', true, false)).toBe('download');
  });

  it('types shared files by extension, never by what the sender claimed', () => {
    expect(shareType('IMG_0001.HEIC')).toBe('image/heic');
    expect(shareType('video.mov')).toBe('video/quicktime');
    expect(shareType('page.html')).toBe('application/octet-stream');
    expect(shareType('jpg')).toBe('application/octet-stream');
  });
});
