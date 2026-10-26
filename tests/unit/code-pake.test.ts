import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codeRoom, hostWithCode, joinWithCode, MAX_FAILED, type HostHandlers, type Requester } from '../../src/lib/signaling/code-rendezvous';

/**
 * An in-memory WebTorrent tracker: offers go to a random other member of the
 * swarm, answers to `to_peer_id`, and a closed socket leaves its swarms (as
 * on a real tracker; otherwise offers would keep going to joiners that are
 * long gone). Every message passing through is recorded, as a tracker
 * operator could.
 */
class FakeTracker {
  swarms = new Map<string, Map<string, FakeSocket>>();
  log: string[] = [];

  leave(socket: FakeSocket): void {
    for (const swarm of this.swarms.values()) {
      for (const [id, s] of swarm) if (s === socket) swarm.delete(id);
    }
  }

  handle(from: FakeSocket, text: string): void {
    this.log.push(text);
    const msg = JSON.parse(text) as Record<string, any>;
    const swarm = this.swarms.get(msg.info_hash) ?? new Map<string, FakeSocket>();
    this.swarms.set(msg.info_hash, swarm);
    swarm.set(msg.peer_id, from);
    const deliver = (to: FakeSocket | undefined, body: object) => to && queueMicrotask(() => to.receive(JSON.stringify({ action: 'announce', info_hash: msg.info_hash, peer_id: msg.peer_id, ...body })));
    if (msg.answer) return deliver(swarm.get(msg.to_peer_id), { answer: msg.answer, offer_id: msg.offer_id });
    // Like bittorrent-tracker: each offer goes to a different random member.
    const others = [...swarm].filter(([id]) => id !== msg.peer_id).map(([, s]) => s).sort(() => Math.random() - 0.5);
    (msg.offers ?? []).forEach((o: { offer: unknown; offer_id: string }, i: number) => deliver(others[i], { offer: o.offer, offer_id: o.offer_id }));
  }
}

let tracker: FakeTracker;

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    // One tracker is enough for these tests; the other URLs never open.
    if (!url.includes('openwebtorrent')) return;
    setTimeout(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    }, 0);
  }
  send(text: string) {
    tracker.handle(this, text);
  }
  receive(text: string) {
    this.onmessage?.({ data: text });
  }
  close() {
    this.readyState = 3;
    tracker.leave(this);
  }
}

const me: Requester = { name: 'Vega 27', kind: 'phone', os: 'android' };
const stops: Array<() => void> = [];

function host(code: string, overrides: Partial<HostHandlers> = {}) {
  const events: string[] = [];
  const handlers: HostHandlers = {
    onRequest: async (from) => {
      events.push(`request ${from.name}`);
      return true;
    },
    onOffer: async (offer) => {
      events.push(`offer ${offer}`);
      return `answer to ${offer}`;
    },
    onFailedTry: (n) => events.push(`failed ${n}`),
    onLocked: () => events.push('locked'),
    onError: (m) => events.push(`error ${m}`),
    ...overrides,
  };
  stops.push(hostWithCode(code, handlers));
  return events;
}

/** Lets the host join the swarm before anyone looks for it. */
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  tracker = new FakeTracker();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
});

describe('6-digit code pairing (PAKE over trackers)', () => {
  it('the right code connects after the host accepts, and the host learns who asks', async () => {
    const events = host('482913');
    await settle();
    const waiting = vi.fn();
    await expect(joinWithCode('482913', 'TS1.offer', me, { onWaitingApproval: waiting })).resolves.toBe('answer to TS1.offer');
    expect(events).toEqual(['request Vega 27', 'offer TS1.offer']);
    expect(waiting).toHaveBeenCalled();
  });

  it('the tracker sees neither the connection codes nor anything that pins down the code', async () => {
    host('482913');
    await settle();
    await joinWithCode('482913', 'TS1.secret-offer', me);
    const log = tracker.log.join('\n');
    expect(log).not.toContain('secret-offer');
    expect(log).not.toContain('482913');
    expect(log).not.toContain('Vega 27');
    // The room comes from the first digit only.
    expect(await codeRoom('482913')).toBe(await codeRoom('400000'));
    expect(await codeRoom('482913')).not.toBe(await codeRoom('582913'));
  });

  it('a declined request fails with a clear message', async () => {
    host('482913', { onRequest: async () => false });
    await settle();
    await expect(joinWithCode('482913', 'TS1.offer', me)).rejects.toThrow('kabul etmedi');
  });

  // Each refusal waits out the grace period in which the joiner keeps looking for a host with its code.
  it('a wrong code (same room) is refused, counted, and the room closes after too many', { timeout: 20_000 }, async () => {
    const events = host('482913');
    await settle();
    for (let i = 1; i < MAX_FAILED; i++) {
      await expect(joinWithCode('400000', 'TS1.offer', me)).rejects.toThrow('Kod yanlış');
      expect(events.at(-1)).toBe(`failed ${i}`);
    }
    await expect(joinWithCode('411111', 'TS1.offer', me)).rejects.toThrow('çok kez yanlış');
    expect(events.at(-1)).toBe('locked');
    expect(events.some((e) => e.startsWith('offer') || e.startsWith('request'))).toBe(false);
  });

  it('a stranger answering first is not taken as "wrong code": the joiner keeps looking for its host', { timeout: 10_000 }, async () => {
    host('499999');
    await settle();
    const joined = joinWithCode('482913', 'TS1.offer', me);
    await new Promise((r) => setTimeout(r, 500)); // the stranger has said no by now
    const mine = host('482913');
    await expect(joined).resolves.toBe('answer to TS1.offer');
    expect(mine).toContain('offer TS1.offer');
  });

  it('two hosts in the same room: the joiner reaches the one with its code', async () => {
    const other = host('499999');
    const mine = host('482913');
    await settle();
    await expect(joinWithCode('482913', 'TS1.offer', me)).resolves.toBe('answer to TS1.offer');
    expect(mine).toContain('offer TS1.offer');
    expect(other.some((e) => e.startsWith('offer'))).toBe(false);
  });
});
