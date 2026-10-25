import { useSyncExternalStore } from 'react';
import { NearbyNetwork, type IncomingRequest, type NearbyDevice } from '../lib/signaling/nearby';
import { selfDevice, type DeviceInfo } from '../lib/device';
import { session } from './useSession';
import { profile } from './useProfile';

export interface NearbySnapshot {
  status: 'off' | 'searching' | 'active' | 'unavailable';
  self: DeviceInfo;
  devices: NearbyDevice[];
  incoming: IncomingRequest | null;
  outgoing: { device: NearbyDevice; requestId: string | null } | null;
  notice: string | null;
}

class Nearby {
  private state: NearbySnapshot = {
    status: 'off',
    self: selfDevice(),
    devices: [],
    incoming: null,
    outgoing: null,
    notice: null,
  };
  private listeners = new Set<() => void>();
  private net: NearbyNetwork | null = null;

  constructor() {
    // A renamed device shows its new name on the radar and to nearby devices right away.
    profile.subscribe(() => {
      const self = selfDevice();
      if (self.name === this.state.self.name) return;
      this.set({ self });
      this.net?.setSelf(self);
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<NearbySnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  start(): void {
    if (this.net) return;
    const net = new NearbyNetwork(this.state.self, {
      onDevices: (devices) => this.net === net && this.set({ devices }),
      onRequest: (incoming) => this.net === net && this.set({ incoming }),
      onRequestCancelled: (id) => {
        if (this.state.incoming?.requestId === id) this.set({ incoming: null });
      },
      onUnavailable: () => this.net === net && this.set({ status: 'unavailable', devices: [] }),
    });
    this.net = net;
    this.set({ status: 'searching' });
    void net.start().then(() => {
      if (this.net === net && this.state.status === 'searching') this.set({ status: 'active' });
    });
  }

  stop(): void {
    this.net?.stop();
    this.net = null;
    this.set({ status: 'off', devices: [], incoming: null, outgoing: null });
  }

  /** Sends a connection request carrying our WebRTC offer, then applies their answer. */
  async connect(device: NearbyDevice): Promise<void> {
    const net = this.net;
    if (!net || this.state.outgoing) return;
    this.set({ outgoing: { device, requestId: null }, notice: null });
    const offer = await session.startNearbyOffer(device.name);
    if (!offer || this.net !== net) return this.set({ outgoing: null });

    const { requestId, answer } = net.request(device.id, offer);
    this.set({ outgoing: { device, requestId } });
    const reply = await answer;
    if (this.getSnapshot().outgoing?.requestId !== requestId) return; // cancelled meanwhile
    this.set({ outgoing: null });
    if (!reply) {
      session.reset();
      this.set({ notice: `${device.name} bağlantıyı kabul etmedi ya da yanıt vermedi.` });
      return;
    }
    const error = await session.submitAnswer(reply);
    if (error) {
      session.reset();
      this.set({ notice: error });
    }
  }

  cancelOutgoing(): void {
    const outgoing = this.state.outgoing;
    if (outgoing?.requestId) this.net?.cancelRequest(outgoing.device.id, outgoing.requestId);
    this.set({ outgoing: null });
    session.reset();
  }

  async accept(): Promise<void> {
    const request = this.state.incoming;
    if (!request || !this.net) return;
    this.set({ incoming: null, outgoing: null, notice: null });
    const answer = await session.acceptNearbyOffer(request.offer, request.from.name);
    this.net?.respond(request.from.id, request.requestId, answer);
  }

  decline(): void {
    const request = this.state.incoming;
    if (!request) return;
    this.net?.respond(request.from.id, request.requestId, null);
    this.set({ incoming: null });
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }
}

export const nearby = new Nearby();

export function useNearby(): NearbySnapshot {
  return useSyncExternalStore(nearby.subscribe, nearby.getSnapshot);
}
