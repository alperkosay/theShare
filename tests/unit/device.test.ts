import { describe, expect, it } from 'vitest';
import { detectDeviceKind, detectDeviceOs, deviceLabel, parseDeviceType } from '../../src/lib/device';
import { parseControl } from '../../src/lib/transfer/protocol';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/140.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36',
};

describe('device detection', () => {
  it.each([
    ['iphone', 0, 'iPhone'],
    ['ipad', 5, 'iPad'], // iPadOS pretends to be a Mac; touch gives it away
    ['androidPhone', 5, 'Android telefon'],
    ['androidTablet', 5, 'Android tablet'],
    ['windows', 0, 'Windows bilgisayar'],
    ['mac', 0, 'Mac'],
    ['linux', 0, 'Linux bilgisayar'],
  ] as const)('%s → %s', (key, touch, label) => {
    const ua = UA[key];
    expect(deviceLabel({ kind: detectDeviceKind(ua, touch), os: detectDeviceOs(ua, touch) })).toBe(label);
  });

  it('sanitizes device types received from peers', () => {
    expect(parseDeviceType('phone', 'ios')).toEqual({ kind: 'phone', os: 'ios' });
    expect(parseDeviceType('toaster', '<script>')).toEqual({ kind: 'computer', os: 'other' });
  });
});

describe('text and hello messages', () => {
  it('accepts text within limits and rejects empty or oversized text', () => {
    expect(parseControl(JSON.stringify({ t: 'text', id: 'm1', text: 'merhaba' }))).toEqual({ t: 'text', id: 'm1', text: 'merhaba' });
    expect(parseControl(JSON.stringify({ t: 'text', id: 'm1', text: '' }))).toBeNull();
    expect(parseControl(JSON.stringify({ t: 'text', id: 'm1', text: 'x'.repeat(100_001) }))).toBeNull();
    expect(parseControl(JSON.stringify({ t: 'text', id: 'm1', text: 42 }))).toBeNull();
  });

  it('cleans the peer name and type in hello', () => {
    expect(parseControl(JSON.stringify({ t: 'hello', v: 1, name: ' Mavi\u0007 Kaplan ', kind: 'phone', os: 'android' }))).toEqual({
      t: 'hello',
      v: 1,
      name: 'Mavi Kaplan',
      kind: 'phone',
      os: 'android',
    });
    expect(parseControl(JSON.stringify({ t: 'hello', v: 1 }))).toEqual({ t: 'hello', v: 1 });
  });
});
