import { describe, expect, it } from 'vitest';
import { MAX_FILES_PER_TRANSFER, parseControl, sanitizeFileName } from '../../src/lib/transfer/protocol';
import { formatBytes } from '../../src/lib/format';

describe('parseControl', () => {
  it('accepts well-formed messages', () => {
    expect(parseControl('{"t":"accept","id":"abc123"}')).toEqual({ t: 'accept', id: 'abc123' });
    expect(parseControl('{"t":"ack","id":"abc","bytes":1048576}')).toEqual({ t: 'ack', id: 'abc', bytes: 1048576 });
    expect(parseControl('{"t":"file-start","id":"abc","index":0}')).toEqual({ t: 'file-start', id: 'abc', index: 0 });
    expect(parseControl('{"t":"cancel","id":"abc","reason":"x"}')).toEqual({ t: 'cancel', id: 'abc', reason: 'x' });
  });

  it('sanitises file names inside offers and keeps zero-byte files', () => {
    const msg = parseControl(JSON.stringify({ t: 'offer', id: 'x1', files: [{ name: '../../etc/passwd', size: 0, type: 'text/plain' }] }));
    expect(msg).toEqual({ t: 'offer', id: 'x1', files: [{ name: '_.._etc_passwd', size: 0, type: 'text/plain' }] });
  });

  it('rejects malformed or hostile messages', () => {
    const bad = [
      'not json',
      '42',
      'null',
      '{"t":"unknown","id":"a"}',
      '{"t":"accept"}',
      '{"t":"accept","id":"has space"}',
      '{"t":"ack","id":"a","bytes":-1}',
      '{"t":"ack","id":"a","bytes":1.5}',
      '{"t":"file-start","id":"a","index":"0"}',
      '{"t":"offer","id":"a","files":[]}',
      '{"t":"offer","id":"a","files":[{"name":"a","size":-5}]}',
      '{"t":"offer","id":"a","files":[{"name":"a","size":1e300}]}',
      JSON.stringify({ t: 'offer', id: 'a', files: Array(MAX_FILES_PER_TRANSFER + 1).fill({ name: 'a', size: 1 }) }),
    ];
    for (const text of bad) expect(parseControl(text), text).toBeNull();
  });

  it('accepts the security-code messages only with 32-byte hex values', () => {
    const hex = 'ab'.repeat(32);
    expect(parseControl(JSON.stringify({ t: 'sas-commit', c: hex }))).toEqual({ t: 'sas-commit', c: hex });
    expect(parseControl(JSON.stringify({ t: 'sas-reveal', n: hex }))).toEqual({ t: 'sas-reveal', n: hex });
    expect(parseControl('{"t":"verified"}')).toEqual({ t: 'verified' });
    for (const bad of [{ t: 'sas-commit' }, { t: 'sas-commit', c: 'ab' }, { t: 'sas-reveal', n: 'AB'.repeat(32) }, { t: 'sas-reveal', n: 5 }]) {
      expect(parseControl(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    }
  });

  it('accepts screen-sharing messages and bounds them', () => {
    expect(parseControl('{"t":"sdp","type":"offer","sdp":"v=0"}')).toEqual({ t: 'sdp', type: 'offer', sdp: 'v=0' });
    expect(parseControl('{"t":"ice","candidate":"candidate:1 1 udp 1 1.2.3.4 5 typ host","mid":"1","index":1}')).toEqual({
      t: 'ice',
      candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
      mid: '1',
      index: 1,
    });
    expect(parseControl('{"t":"ice","candidate":"c","mid":null,"index":null}')).toEqual({ t: 'ice', candidate: 'c', mid: null, index: null });
    expect(parseControl('{"t":"screen","on":true,"audio":true}')).toEqual({ t: 'screen', on: true, audio: true });
    expect(parseControl('{"t":"screen","on":false,"audio":true}')).toEqual({ t: 'screen', on: false });
    expect(parseControl('{"t":"screen-ask"}')).toEqual({ t: 'screen-ask' });
    expect(parseControl('{"t":"screen-no","unsupported":true}')).toEqual({ t: 'screen-no', unsupported: true });

    const bad = [
      '{"t":"sdp","type":"pranswer","sdp":"v=0"}',
      '{"t":"sdp","type":"offer"}',
      JSON.stringify({ t: 'sdp', type: 'offer', sdp: 'x'.repeat(65 * 1024) }),
      '{"t":"ice","candidate":"c","mid":5,"index":0}',
      '{"t":"ice","candidate":"c","mid":"0","index":-1}',
      JSON.stringify({ t: 'ice', candidate: 'x'.repeat(2000), mid: '0', index: 0 }),
      '{"t":"screen","on":"yes"}',
    ];
    for (const text of bad) expect(parseControl(text), text).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['photo.jpg', 'photo.jpg'],
    ['a/b\\c.txt', 'a_b_c.txt'],
    ['  .hidden  ', 'hidden'],
    ['evil‮txt.exe', 'eviltxt.exe'],
    ['line\nbreak.txt', 'linebreak.txt'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['', 'dosya'],
    ['...', 'dosya'],
    ['Türkçe ğüşıöç.pdf', 'Türkçe ğüşıöç.pdf'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('bounds the length but keeps the extension', () => {
    const name = sanitizeFileName('x'.repeat(400) + '.tar.gz');
    expect(name.length).toBe(255);
    expect(name.endsWith('.gz')).toBe(true);
  });
});

describe('formatBytes', () => {
  it('formats with Turkish separators', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
  });
});
