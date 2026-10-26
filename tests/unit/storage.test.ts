import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { dbClear, dbDelete, dbGet, dbGetAll, dbPut, deleteDb } from '../../src/lib/storage/db';
import { normalizeProfile, validateName, DEFAULT_SETTINGS } from '../../src/lib/storage/profile';
import { cleanPeerName } from '../../src/lib/device';
import { parseControl } from '../../src/lib/transfer/protocol';

afterEach(async () => {
  await deleteDb();
});

describe('IndexedDB wrapper', () => {
  it('puts, gets, lists and deletes by keyPath', async () => {
    await dbPut('history', { id: 'a', at: 1 });
    await dbPut('history', { id: 'b', at: 2 });
    expect(await dbGet('history', 'a')).toEqual({ id: 'a', at: 1 });
    expect((await dbGetAll<{ id: string }>('history')).map((e) => e.id).sort()).toEqual(['a', 'b']);
    await dbDelete('history', 'a');
    expect(await dbGet('history', 'a')).toBeUndefined();
    await dbClear('history');
    expect(await dbGetAll('history')).toEqual([]);
  });

  it('stores profile values under out-of-line keys', async () => {
    await dbPut('profile', { name: 'Alper' }, 'me');
    expect(await dbGet('profile', 'me')).toEqual({ name: 'Alper' });
  });

  it('keeps Blobs in the files store', async () => {
    await dbPut('files', { key: 'k', items: [new Blob(['merhaba'])] });
    const record = await dbGet<{ items: Blob[] }>('files', 'k');
    expect(record?.items).toHaveLength(1);
  });

  it('deleteDb removes everything and the database can be reopened', async () => {
    await dbPut('history', { id: 'a', at: 1 });
    await deleteDb();
    expect(await dbGetAll('history')).toEqual([]);
  });
});

describe('display name', () => {
  it('accepts 2–24 visible characters, emoji included', () => {
    expect(validateName('  Alper  ')).toEqual({ name: 'Alper' });
    expect(validateName('Ayşe   Nur')).toEqual({ name: 'Ayşe Nur' });
    expect(validateName('👩‍💻 Deniz')).toEqual({ name: '👩‍💻 Deniz' });
    expect(validateName('👩‍💻'.repeat(24))).toHaveProperty('name'); // one grapheme each
  });

  it('rejects too short, too long and control/bidi characters', () => {
    expect(validateName('A')).toHaveProperty('error');
    expect(validateName('   ')).toHaveProperty('error');
    expect(validateName('x'.repeat(25))).toHaveProperty('error');
    expect(validateName('Al\u0007per')).toHaveProperty('error');
    expect(validateName('Anne‮m')).toHaveProperty('error');
  });

  it('peers get control and bidi characters stripped', () => {
    expect(cleanPeerName(' Anne‮\u0000m ')).toBe('Annem');
    expect(cleanPeerName(42)).toBe('');
  });
});

describe('stored profile', () => {
  it('fills in defaults and replaces invalid values', () => {
    const p = normalizeProfile({ name: 'x', deviceId: 'abc', settings: { includeTexts: true } as never });
    expect(p.name).not.toBe('x');
    expect(p.deviceId).toBe('abc');
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, includeTexts: true });
    expect(normalizeProfile({ settings: { theme: 'neon' } as never }).settings.theme).toBe('soft');
    expect(normalizeProfile({ settings: { theme: 'pastel' } as never }).settings.theme).toBe('pastel');
    expect(normalizeProfile({ settings: { scheme: 'dark' } as never }).settings.scheme).toBe('dark');
    expect(normalizeProfile({ settings: { scheme: 'sepia' } as never }).settings.scheme).toBe('system');
  });

  it('creates a fresh identity when nothing is stored', () => {
    const a = normalizeProfile(undefined);
    const b = normalizeProfile(undefined);
    expect(a.deviceId).not.toBe(b.deviceId);
    expect(a.settings.keepHistory).toBe(true);
    expect(a.settings.includeTexts).toBe(false);
  });
});

describe('hello carries the persistent device id', () => {
  it('keeps a valid id and drops a malformed one', () => {
    const id = '0b6f1c1e-6a5e-4b7a-9d55-3c1d2a7e9f10';
    expect(parseControl(JSON.stringify({ t: 'hello', v: 1, name: 'Alper', kind: 'phone', os: 'ios', id }))).toMatchObject({ id });
    expect(parseControl(JSON.stringify({ t: 'hello', v: 1, name: 'Alper', id: '<script>' }))).not.toHaveProperty('id');
  });
});
