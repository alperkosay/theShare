import { afterEach, describe, expect, it } from 'vitest';
import { TransferManager } from '../../src/lib/transfer/manager';
import type { PeerLink } from '../../src/lib/webrtc/peer';

/** Just enough of a PeerLink: an open channel that records what the manager sends. */
function fakeLink() {
  const sent: Array<Record<string, unknown>> = [];
  const channel = {
    readyState: 'open',
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    addEventListener() {},
    removeEventListener() {},
  };
  const link = { channel, sendText: (text: string) => sent.push(JSON.parse(text)), sendBinary() {} } as unknown as PeerLink;
  return { link, sent };
}

const managers: TransferManager[] = [];
function connect() {
  const { link, sent } = fakeLink();
  const manager = new TransferManager(link);
  managers.push(manager);
  return { manager, sent, receive: (msg: object) => manager.handleMessage(JSON.stringify(msg)) };
}

afterEach(() => {
  for (const m of managers.splice(0)) m.dispose();
});

describe('verification gate', () => {
  it('sends nothing but the hello before verification', () => {
    const { manager, sent } = connect();
    expect(sent.map((m) => m.t)).toEqual(['hello']);
    expect(manager.canSend).toBe(false);
    expect(() => manager.sendText('parola123')).toThrow(/doğrulayın/);
    expect(() => manager.sendFiles([new File(['x'], 'a.txt')])).toThrow(/doğrulayın/);
    manager.sendMedia({ t: 'screen', on: true });
    expect(sent.map((m) => m.t)).toEqual(['hello']);
  });

  it('turns down offers and screen requests, drops texts and screen messages', () => {
    const { manager, sent, receive } = connect();
    const texts: string[] = [];
    const media: string[] = [];
    manager.onText = (m) => texts.push(m.text);
    manager.onMedia = (m) => media.push(m.t);

    receive({ t: 'offer', id: 'x1', files: [{ name: 'a.exe', size: 1, type: '' }] });
    receive({ t: 'text', id: 't1', text: 'tıkla: http://kötü' });
    receive({ t: 'screen-ask' });
    receive({ t: 'sdp', type: 'offer', sdp: 'v=0' });

    expect(manager.views).toEqual([]);
    expect(texts).toEqual([]);
    expect(media).toEqual([]);
    expect(sent.slice(1)).toEqual([{ t: 'reject', id: 'x1', reason: 'unverified' }, { t: 'screen-no' }]);
  });

  it('lets the handshake through', () => {
    const { manager, receive } = connect();
    const seen: string[] = [];
    manager.onHello = (v) => seen.push(`hello ${v}`);
    manager.onSas = (m) => seen.push(m.t);
    manager.onPeerVerified = () => seen.push('verified');
    receive({ t: 'hello', v: 2, name: 'Vega 27' });
    receive({ t: 'sas-commit', c: 'a'.repeat(64) });
    receive({ t: 'sas-reveal', n: 'b'.repeat(64) });
    receive({ t: 'verified' });
    expect(seen).toEqual(['hello 2', 'sas-commit', 'sas-reveal', 'verified']);
  });

  it('opens once both sides have verified', () => {
    const { manager, sent, receive } = connect();
    manager.setVerified();
    expect(sent.at(-1)).toEqual({ t: 'verified' });
    expect(manager.gateError).toMatch(/Karşı cihaz/);
    expect(() => manager.sendText('merhaba')).toThrow(/Karşı cihaz/);

    receive({ t: 'verified' });
    expect(manager.gateError).toBeNull();
    expect(manager.canSend).toBe(true);
    manager.sendText('merhaba');
    expect(sent.at(-1)).toMatchObject({ t: 'text', text: 'merhaba' });

    // Our side verified: offers are no longer turned down.
    receive({ t: 'offer', id: 'x2', files: [{ name: 'a.txt', size: 1, type: '' }] });
    expect(manager.views.map((v) => v.status)).toEqual(['pending']);
  });
});
