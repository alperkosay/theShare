import { useSyncExternalStore } from 'react';
import { PeerLink, type LinkState } from '../lib/webrtc/peer';
import { SignalError } from '../lib/webrtc/signal-codec';
import { pairingCode } from '../lib/webrtc/pairing-code';
import { CODE_TTL_MS, generateCode, hostWithCode, joinWithCode, normalizeCode } from '../lib/signaling/code-rendezvous';
import { TransferManager, type TransferView } from '../lib/transfer/manager';

export type Role = 'host' | 'join';
/**
 * 'code': 6-digit code via public trackers (needs internet).
 * 'nearby': picked from the nearby-devices list (same public IP, needs internet).
 * 'qr': two QR scans, works offline on a LAN.
 */
export type Method = 'code' | 'nearby' | 'qr';

export interface SessionSnapshot {
  role: Role | null;
  method: Method;
  linkState: LinkState;
  error: string | null;
  /** 6-digit code shown by the host in 'code' mode. */
  pairCode: string | null;
  /** Name of the nearby device we are connecting to ('nearby' mode). */
  peerName: string | null;
  /** QR mode: our offer (host) or answer (joiner) payload to show as QR/text. */
  localCode: string | null;
  wasConnected: boolean;
  pairingCode: string | null;
  transfers: TransferView[];
}

const initial: SessionSnapshot = {
  role: null,
  method: 'code',
  linkState: 'idle',
  error: null,
  pairCode: null,
  peerName: null,
  localCode: null,
  wasConnected: false,
  pairingCode: null,
  transfers: [],
};

/**
 * Owns the PeerLink + TransferManager outside React; components subscribe
 * through useSyncExternalStore. Holds no persistent state: everything lives
 * in memory and is dropped on reset().
 */
class Session {
  private state: SessionSnapshot = initial;
  private listeners = new Set<() => void>();
  private peerLeft = false;
  private stopRendezvous: (() => void) | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  link: PeerLink | null = null;
  manager: TransferManager | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<SessionSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------------------
  // 6-digit code
  // ---------------------------------------------------------------------------

  /** Host: show a fresh code and wait for someone to enter it. */
  startCodeHost(): void {
    this.reset({ role: 'host', method: 'code' });
    const code = generateCode();
    this.set({ pairCode: code });
    this.stopRendezvous = hostWithCode(code, {
      onOffer: async (offer) => {
        this.detachLink()?.close(); // an earlier attempt that went nowhere
        return this.attachLink(new PeerLink({ remote: true })).acceptOffer(offer);
      },
      onError: (message) => this.set({ linkState: 'failed', error: message }),
    });
    this.expiryTimer = setTimeout(() => {
      if (!this.state.wasConnected) {
        this.reset({ role: 'host', method: 'code', linkState: 'failed', error: 'Kodun süresi doldu.' });
      }
    }, CODE_TTL_MS);
  }

  /** Joiner: connect with a code. Returns a user-facing error, or null. */
  async joinCode(input: string): Promise<string | null> {
    const code = normalizeCode(input);
    if (!code) return 'Kod 6 haneli olmalı.';
    this.reset({ role: 'join', method: 'code' });
    const link = this.attachLink(new PeerLink({ remote: true }));
    try {
      const offer = await link.createOffer();
      const answer = await joinWithCode(code, offer);
      if (this.link !== link) return null;
      await link.acceptAnswer(answer);
      return null;
    } catch (e) {
      if (this.link !== link) return null;
      this.reset({ role: 'join', method: 'code' });
      return e instanceof SignalError ? e.message : 'Bağlanılamadı. Tekrar deneyin.';
    }
  }

  // ---------------------------------------------------------------------------
  // Nearby devices (the discovery/request messaging lives in useNearby)
  // ---------------------------------------------------------------------------

  /** Requester: creates our offer. Returns null if that failed (state shows the error). */
  async startNearbyOffer(peerName: string): Promise<string | null> {
    this.reset({ role: 'join', method: 'nearby', peerName });
    const link = this.attachLink(new PeerLink({ remote: true }));
    try {
      return await link.createOffer();
    } catch {
      return null;
    }
  }

  /** Accepting side: applies their offer and returns our answer, or null on failure. */
  async acceptNearbyOffer(offer: string, peerName: string): Promise<string | null> {
    this.reset({ role: 'host', method: 'nearby', peerName });
    const link = this.attachLink(new PeerLink({ remote: true }));
    try {
      return await link.acceptOffer(offer);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // QR (offline fallback)
  // ---------------------------------------------------------------------------

  /** Host: create the offer. */
  async startHost(): Promise<void> {
    this.reset({ role: 'host', method: 'qr' });
    const link = this.attachLink(new PeerLink());
    try {
      const code = await link.createOffer();
      if (this.link === link) this.set({ localCode: code });
    } catch {
      // PeerLink already moved to 'failed' with a user-facing message.
    }
  }

  /** Host: apply the answer. Returns a user-facing error, or null on success. */
  async submitAnswer(text: string): Promise<string | null> {
    if (!this.link) return 'Oturum bulunamadı. Baştan başlayın.';
    try {
      await this.link.acceptAnswer(text);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Yanıt kodu uygulanamadı.';
    }
  }

  /** Joiner: apply the offer and create the answer. Returns a user-facing error, or null. */
  async startJoin(offerText: string): Promise<string | null> {
    this.reset({ role: 'join', method: 'qr' });
    const link = this.attachLink(new PeerLink());
    try {
      const code = await link.acceptOffer(offerText);
      if (this.link === link) this.set({ localCode: code });
      return null;
    } catch (e) {
      if (e instanceof SignalError && this.link === link && link.state === 'idle') {
        // Bad input: let the user fix it without entering the error state.
        this.reset({ role: 'join', method: 'qr' });
        return e.message;
      }
      return null; // shown through linkState 'failed'
    }
  }

  // ---------------------------------------------------------------------------

  /** Same role and method, fresh connection (after a failure). */
  retry() {
    const { role, method } = this.state;
    if (method === 'nearby') {
      this.reset();
    } else if (role === 'host') {
      if (method === 'code') this.startCodeHost();
      else void this.startHost();
    } else {
      this.reset({ role, method });
    }
  }

  sendFiles(files: File[]): string | null {
    try {
      this.manager?.sendFiles(files);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Dosyalar gönderilemedi.';
    }
  }

  /** Graceful disconnect + full cleanup. */
  leave() {
    this.manager?.sayGoodbye();
    const link = this.detachLink();
    this.reset();
    // Give the goodbye message a moment to flush before closing.
    if (link) setTimeout(() => link.close(), 150);
  }

  reset(patch: Partial<SessionSnapshot> = {}) {
    this.stopRendezvous?.();
    this.stopRendezvous = null;
    clearTimeout(this.expiryTimer);
    this.manager?.dispose();
    this.manager = null;
    this.detachLink()?.close();
    this.peerLeft = false;
    this.set({ ...initial, ...patch });
  }

  private detachLink(): PeerLink | null {
    const link = this.link;
    this.link = null;
    if (link) {
      link.onStateChange = () => {};
      link.onMessage = () => {};
    }
    return link;
  }

  private attachLink(link: PeerLink): PeerLink {
    this.link = link;
    link.onMessage = (data) => this.manager?.handleMessage(data);
    link.onStateChange = (linkState, error) => {
      if (this.link !== link) return;
      if (linkState === 'connected') {
        this.stopRendezvous?.();
        this.stopRendezvous = null;
        clearTimeout(this.expiryTimer);
        const manager = new TransferManager(link);
        manager.onChange = (transfers) => this.set({ transfers });
        manager.onPeerLeft = () => {
          this.peerLeft = true;
        };
        this.manager = manager;
        this.set({ linkState, error, wasConnected: true });
        void pairingCode(link.localSdp, link.remoteSdp).then((code) => {
          if (this.link === link) this.set({ pairingCode: code });
        });
        return;
      }
      if (linkState === 'failed' && this.state.wasConnected) {
        const message = this.peerLeft ? 'Karşı cihaz oturumu kapattı.' : (error ?? 'Bağlantı koptu.');
        this.manager?.handleDisconnect(message);
        this.set({ linkState, error: message });
        return;
      }
      this.set({ linkState, error });
    };
    return link;
  }
}

export const session = new Session();

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
