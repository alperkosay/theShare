import { describe, expect, it } from 'vitest';
import {
  buildOfferLink,
  decodeSignal,
  encodeSignal,
  extractPayload,
  MAX_SIGNAL_TEXT_LENGTH,
  SignalError,
  sdpToCompact,
  validateSdp,
  type SessionDescription,
} from '../../src/lib/webrtc/signal-codec';

const FP = Array.from({ length: 32 }, (_, i) => ((i * 37 + 11) & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(':');

// Shaped like a Chrome non-trickle data channel offer (mDNS host candidates).
const CHROME_OFFER: SessionDescription = {
  type: 'offer',
  sdp: [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:3442302146 1 udp 2113937151 6b0a8e7e-1f3c-4b2a-9d0e-0a1b2c3d4e5f.local 54321 typ host generation 0 network-cost 999',
    'a=candidate:1872382912 1 udp 2113939711 1d2c3b4a-aaaa-bbbb-cccc-111122223333.local 54322 typ host generation 0 network-cost 999',
    'a=ice-ufrag:Xk3d',
    'a=ice-pwd:kJ9s8d7f6g5h4j3k2l1qwert',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FP}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n'),
};

// Shaped like a Firefox answer: session-level fingerprint, TCP + srflx candidates.
const FIREFOX_ANSWER: SessionDescription = {
  type: 'answer',
  sdp: [
    'v=0',
    'o=mozilla...THIS_IS_SDPARTA-140.0 7012345678901234567 0 IN IP4 0.0.0.0',
    's=-',
    't=0 0',
    `a=fingerprint:sha-256 ${FP}`,
    'a=group:BUNDLE 0',
    'a=ice-options:trickle',
    'a=msid-semantic:WMS *',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=candidate:0 1 UDP 2122252543 192.168.1.23 61234 typ host',
    'a=candidate:1 1 TCP 2105524479 192.168.1.23 9 typ host tcptype active',
    'a=candidate:2 1 UDP 1686052863 85.100.1.2 61234 typ srflx raddr 192.168.1.23 rport 61234',
    'a=candidate:3 1 UDP 2122187007 fe80::1c2b:3aff:fe4d:5e6f 61235 typ host',
    'a=sendrecv',
    'a=end-of-candidates',
    'a=ice-pwd:3f2b5e0c8a1d4e6f7a8b9c0d1e2f3a4b',
    'a=ice-ufrag:9a8b7c6d',
    'a=mid:0',
    'a=setup:active',
    'a=sctp-port:5000',
    'a=max-message-size:1073741823',
    '',
  ].join('\r\n'),
};

describe('compact signal codec', () => {
  it('round-trips a Chrome-style offer through the compact form', async () => {
    const code = await encodeSignal(CHROME_OFFER);
    expect(code.startsWith('TS1.')).toBe(true);
    expect(code.length).toBeLessThan(200);

    const decoded = await decodeSignal(code, 'offer');
    expect(decoded.type).toBe('offer');
    expect(sdpToCompact(decoded)).toEqual(sdpToCompact(CHROME_OFFER));
  });

  it('round-trips a Firefox-style answer, keeping UDP candidates and dropping TCP', async () => {
    const decoded = await decodeSignal(await encodeSignal(FIREFOX_ANSWER), 'answer');
    const compact = sdpToCompact(decoded);
    expect(compact.setup).toBe('active');
    expect(compact.maxMessageSize).toBe(1073741823);
    expect(compact.candidates).toEqual([
      { address: '192.168.1.23', port: 61234, type: 'host' },
      { address: '85.100.1.2', port: 61234, type: 'srflx' },
      { address: 'fe80::1c2b:3aff:fe4d:5e6f', port: 61235, type: 'host' },
    ]);
    expect(decoded.sdp).not.toMatch(/tcptype/);
  });

  it('rebuilds an SDP that passes validation and keeps the DTLS fingerprint', async () => {
    const decoded = await decodeSignal(await encodeSignal(CHROME_OFFER), 'offer');
    expect(() => validateSdp(decoded.sdp)).not.toThrow();
    expect(decoded.sdp).toContain(`a=fingerprint:sha-256 ${FP}`);
    expect(decoded.sdp).toContain('a=ice-ufrag:Xk3d');
    expect(decoded.sdp).toContain('a=setup:actpass');
  });

  it('falls back to the compressed full SDP when the compact form cannot express it', async () => {
    const sha384 = Array.from({ length: 48 }, () => 'AB').join(':');
    const unusual = { ...CHROME_OFFER, sdp: CHROME_OFFER.sdp.replace(/a=fingerprint:.*\r\n/, `a=fingerprint:sha-384 ${sha384}\r\n`) };
    const code = await encodeSignal(unusual);
    expect(code.startsWith('TSZ.')).toBe(true);
    expect(await decodeSignal(code, 'offer')).toEqual(unusual);
  });
});

describe('payload extraction', () => {
  it('accepts the offer link, the bare code and line-wrapped pastes', async () => {
    const code = await encodeSignal(CHROME_OFFER);
    const link = buildOfferLink('https://example.github.io/theshare/', code);
    expect(link).toBe(`https://example.github.io/theshare/#s=${code}`);
    expect(extractPayload(link)).toBe(code);
    expect(extractPayload(`  ${code.slice(0, 40)}\n${code.slice(40)}  `)).toBe(code);
    await expect(decodeSignal(link, 'offer')).resolves.toMatchObject({ type: 'offer' });
  });
});

describe('invalid input', () => {
  const rejects = (input: string, kind: 'offer' | 'answer' = 'offer') =>
    expect(decodeSignal(input, kind)).rejects.toBeInstanceOf(SignalError);

  it('rejects empty, foreign and oversized input', async () => {
    await rejects('');
    await rejects('hello world');
    await rejects('https://example.com/');
    await rejects('TS1.' + 'A'.repeat(MAX_SIGNAL_TEXT_LENGTH));
  });

  it('rejects invalid base64 and truncated payloads', async () => {
    const code = await encodeSignal(CHROME_OFFER);
    await rejects('TS1.!!!');
    await rejects(code.slice(0, 30));
    await rejects(code + 'AAAA');
    await rejects('TSZ.AAAA');
  });

  it('explains a mixed-up offer/answer', async () => {
    const code = await encodeSignal(CHROME_OFFER);
    await expect(decodeSignal(code, 'answer')).rejects.toThrow(/DAVET kodu|davet kodu/);
  });

  it('never throws anything but SignalError on corrupted codes', async () => {
    const code = await encodeSignal(CHROME_OFFER);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 300; i++) {
      const chars = code.split('');
      const pos = 4 + rand(chars.length - 4);
      chars[pos] = alphabet[rand(alphabet.length)]!;
      try {
        await decodeSignal(chars.join(''), 'offer');
      } catch (e) {
        expect(e).toBeInstanceOf(SignalError);
      }
    }
  });

  it('rejects SDPs with media other than a single data channel', () => {
    const withAudio = CHROME_OFFER.sdp.replace('m=application', 'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application');
    expect(() => validateSdp(withAudio)).toThrow(SignalError);
    expect(() => validateSdp('hello')).toThrow(SignalError);
    expect(() => validateSdp(CHROME_OFFER.sdp.replace(/a=ice-pwd:.*\r\n/, ''))).toThrow(SignalError);
  });

  it('rejects a full-SDP payload carrying an invalid SDP', async () => {
    const bad = { type: 'offer' as const, sdp: CHROME_OFFER.sdp.replace('webrtc-datachannel', 'something-else') };
    await expect(encodeSignal(bad)).rejects.toBeInstanceOf(SignalError);
  });
});
