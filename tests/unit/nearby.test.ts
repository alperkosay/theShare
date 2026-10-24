import { describe, expect, it } from 'vitest';
import { ipv6Prefix } from '../../src/lib/signaling/nearby';
import { detectDeviceKind, randomDeviceName } from '../../src/lib/device';

describe('ipv6Prefix', () => {
  it('returns the expanded /64 prefix', () => {
    expect(ipv6Prefix('2a02:4780:a:1234:5678:9abc:def0:1')).toBe('2a02:4780:000a:1234');
    expect(ipv6Prefix('2001:db8::1')).toBe('2001:0db8:0000:0000');
    expect(ipv6Prefix('2001:DB8:1:2::')).toBe('2001:0db8:0001:0002');
  });

  it('rejects malformed addresses', () => {
    expect(ipv6Prefix('not-an-ip')).toBeNull();
    expect(ipv6Prefix('1:2:3')).toBeNull();
    expect(ipv6Prefix('12345::1')).toBeNull();
  });
});

describe('device identity', () => {
  it('makes two-word Turkish names', () => {
    expect(randomDeviceName()).toMatch(/^\S+ \S+$/u);
  });

  it('classifies common user agents', () => {
    expect(detectDeviceKind('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe('phone');
    expect(detectDeviceKind('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('phone');
    expect(detectDeviceKind('Mozilla/5.0 (Linux; Android 14; SM-X710) Safari/537.36')).toBe('tablet');
    expect(detectDeviceKind('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0')).toBe('computer');
  });
});
