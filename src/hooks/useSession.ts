import { useSyncExternalStore } from 'react';
import { PeerLink, type LinkState } from '../lib/webrtc/peer';
import { SignalError } from '../lib/webrtc/signal-codec';
import { SasExchange } from '../lib/webrtc/verify';
import { judgeTrust, type TrustedDevice } from '../lib/storage/trusted';
import { PROTOCOL_VERSION } from '../lib/transfer/protocol';
import { CODE_TTL_MS, generateCode, hostWithCode, joinWithCode, MAX_FAILED, normalizeCode, type Requester } from '../lib/signaling/code-rendezvous';
import { selfDevice } from '../lib/device';
import { TransferManager, type PeerInfo, type TextMessage, type TransferRecord, type TransferView } from '../lib/transfer/manager';
import { rooms } from './useRooms';
import { trusted } from './useTrusted';

export type Role = 'host' | 'join';
/**
 * 'code': 6-digit code via public trackers (needs internet).
 * 'nearby': picked from the nearby-devices list (same public IP, needs internet).
 * 'qr': two QR scans, works offline on a LAN.
 */
export type Method = 'code' | 'nearby' | 'qr';

/**
 * Whether the connection is known to reach the device the user means:
 *  checking    connected, the security code isn't ready yet
 *  unverified  the user has to compare the code on both screens
 *  changed     like unverified, but the other side claims to be a trusted device with another certificate
 *  failed      the code exchange was tampered with: only disconnecting is offered
 *  verified    codes matched, a trusted certificate, the 6-digit code pairing (PAKE), or the other device's QR was scanned here
 * Files, texts and screen sharing wait for 'verified' (lib/transfer/manager).
 */
export type VerifyState = 'checking' | 'unverified' | 'changed' | 'failed' | 'verified';
export type VerifiedBy = 'code' | 'trusted' | 'scan' | 'pairing';

export interface SessionSnapshot {
  role: Role | null;
  method: Method;
  linkState: LinkState;
  error: string | null;
  /** 'code' mode: the 6-digit room code (shown by the host, entered by the joiner). Kept after a disconnect for rejoining. */
  pairCode: string | null;
  /** The other device's display name: from the nearby list, or its hello once connected. */
  peerName: string | null;
  /** The other device's type/OS and persistent id, known once connected (from its hello). */
  peer: PeerInfo | null;
  /** QR mode: our offer (host) or answer (joiner) payload to show as QR/text. */
  localCode: string | null;
  wasConnected: boolean;
  /** The security code (lib/webrtc/verify), the same on both screens unless someone is in between. */
  pairingCode: string | null;
  verify: VerifyState;
  verifiedBy: VerifiedBy | null;
  /** The other side has verified too (until then it refuses what we send). */
  peerVerified: boolean;
  /** 'changed': the trusted device it claims to be. Otherwise a trusted device with the same name, if any. */
  lookalike: TrustedDevice | null;
  /** The other device runs an older theShare without the security-code exchange. */
  peerOutdated: boolean;
  /** 'code' host: someone who knows the code asks to connect; the user accepts or declines. */
  codeRequest: Requester | null;
  /** 'code' host: wrong-code tries so far (the room closes at MAX_FAILED). */
  codeFailures: number;
  /** 'code' joiner: the host has our request and its user is being asked. */
  awaitingApproval: boolean;
  transfers: TransferView[];
  /** Text/clipboard messages, oldest first. */
  messages: TextMessage[];
  /** Incoming offers are accepted without asking, for this connection only. */
  autoAccept: boolean;
}

const initial: SessionSnapshot = {
  role: null,
  method: 'code',
  linkState: 'idle',
  error: null,
  pairCode: null,
  peerName: null,
  peer: null,
  localCode: null,
  wasConnected: false,
  pairingCode: null,
  verify: 'checking',
  verifiedBy: null,
  peerVerified: false,
  lookalike: null,
  peerOutdated: false,
  codeRequest: null,
  codeFailures: 0,
  awaitingApproval: false,
  transfers: [],
  messages: [],
  autoAccept: false,
};

/** Who a finished transfer was with, for the history. */
export interface RecordContext {
  peer: PeerInfo | null;
  peerName: string | null;
  method: Method;
}

/**
 * Owns the PeerLink + TransferManager outside React; components subscribe
 * through useSyncExternalStore. Holds no persistent state itself: everything
 * lives in memory and is dropped on reset(). Finished transfers are handed to
 * onRecord, which the history (hooks/useHistory) fills in.
 */
class Session {
  private state: SessionSnapshot = initial;
  private listeners = new Set<() => void>();
  private peerLeft = false;
  private stopRendezvous: (() => void) | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Known before connecting that the other end is the right device: 'scan' when
   * its QR came through our camera (it is the device in front of the user),
   * 'pairing' when the connection codes came sealed with the PAKE key of the
   * 6-digit code (whoever it is knows the code).
   */
  private preVerified: VerifiedBy | null = null;
  private resolveRequest: ((accept: boolean) => void) | null = null;
  link: PeerLink | null = null;
  manager: TransferManager | null = null;
  onRecord: (record: TransferRecord, context: RecordContext) => void = () => {};
  /** The save folder for accepted files, if one is set (hooks/useSaving). */
  saveFolder: () => FileSystemDirectoryHandle | null = () => null;
  /** A connection came up (link + manager), or the current one is gone (null). Screen sharing hooks in here (hooks/useScreen). */
  onConnection: (connection: { link: PeerLink; manager: TransferManager } | null) => void = () => {};

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

  /**
   * Host: show a code and wait for someone to enter it. Pass a recent code to
   * reopen that room: a link shared earlier works again.
   */
  startCodeHost(reuse?: string): void {
    this.reset({ role: 'host', method: 'code' });
    const code = (reuse && normalizeCode(reuse)) || generateCode();
    rooms.remember(code, 'host');
    this.set({ pairCode: code });
    this.stopRendezvous = hostWithCode(code, {
      onRequest: (from) =>
        new Promise<boolean>((resolve) => {
          this.resolveRequest = resolve;
          this.set({ codeRequest: from });
        }),
      onOffer: async (offer) => {
        this.detachLink()?.close(); // an earlier attempt that went nowhere
        this.preVerified = 'pairing';
        return this.attachLink(new PeerLink({ remote: true })).acceptOffer(offer);
      },
      onFailedTry: (count) => this.set({ codeFailures: count }),
      onLocked: () => {
        // Not reopened from "recent rooms" either: someone may be guessing it.
        rooms.forget(code);
        this.reset({
          role: 'host',
          method: 'code',
          linkState: 'failed',
          error: `Kod ${MAX_FAILED} kez yanlış girildi. Biri tahmin ediyor olabilir; güvenliğiniz için oda kapatıldı. Yeni bir kod oluşturun.`,
        });
      },
      onError: (message) => this.set({ linkState: 'failed', error: message }),
    });
    this.expiryTimer = setTimeout(() => {
      if (!this.state.wasConnected) {
        this.reset({ role: 'host', method: 'code', pairCode: code, linkState: 'failed', error: 'Kimse katılmadı, kodun bekleme süresi doldu.' });
      }
    }, CODE_TTL_MS);
  }

  /** Joiner: connect with a code. Returns a user-facing error, or null. */
  async joinCode(input: string): Promise<string | null> {
    const code = normalizeCode(input);
    if (!code) return 'Kod 6 haneli olmalı.';
    this.reset({ role: 'join', method: 'code', pairCode: code });
    const link = this.attachLink(new PeerLink({ remote: true }));
    try {
      const offer = await link.createOffer();
      const { name, kind, os } = selfDevice();
      const answer = await joinWithCode(code, offer, { name, kind, os }, { onWaitingApproval: () => this.link === link && this.set({ awaitingApproval: true }) });
      if (this.link !== link) return null;
      this.preVerified = 'pairing';
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

  /**
   * Host: apply the answer. Returns a user-facing error, or null on success.
   * `scanned`: read by our camera from the other screen, not pasted or relayed.
   */
  async submitAnswer(text: string, { scanned = false } = {}): Promise<string | null> {
    if (!this.link) return 'Oturum bulunamadı. Baştan başlayın.';
    try {
      await this.link.acceptAnswer(text);
      if (scanned) this.preVerified = 'scan';
      this.judge(); // in case the connection came up first
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Yanıt kodu uygulanamadı.';
    }
  }

  /** Joiner: apply the offer and create the answer. Returns a user-facing error, or null. See submitAnswer for `scanned`. */
  async startJoin(offerText: string, { scanned = false } = {}): Promise<string | null> {
    this.reset({ role: 'join', method: 'qr' });
    if (scanned) this.preVerified = 'scan';
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

  /** Same role and method, fresh connection (after a failure). A code host keeps its code. */
  retry() {
    const { role, method, pairCode } = this.state;
    if (method === 'nearby') {
      this.reset();
    } else if (role === 'host') {
      if (method === 'code') this.startCodeHost(pairCode ?? undefined);
      else void this.startHost();
    } else {
      this.reset({ role, method });
    }
  }

  /**
   * Back into a recent code room: the creator reopens it and waits, the other
   * side enters the code again (CodeJoinScreen starts with pairCode).
   */
  rejoinRoom(code: string, role: Role): void {
    if (role === 'host') this.startCodeHost(code);
    else this.reset({ role: 'join', method: 'code', pairCode: code });
  }

  /** 'code' host: the user's answer to the connection request. */
  answerCodeRequest(accept: boolean): void {
    const from = this.state.codeRequest;
    this.resolveRequest?.(accept);
    this.resolveRequest = null;
    this.set({ codeRequest: null, ...(accept && from ? { peerName: from.name } : {}) });
  }

  /** The user saw the same security code on both screens. */
  confirmCode(): void {
    const { verify, pairingCode } = this.state;
    if (pairingCode && (verify === 'unverified' || verify === 'changed')) this.markVerified('code');
  }

  setAutoAccept(on: boolean): void {
    if (this.manager) this.manager.autoAccept = on;
    this.set({ autoAccept: on });
  }

  /** Returns a user-facing error, or null. */
  sendText(text: string): string | null {
    try {
      this.manager?.sendText(text);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Metin gönderilemedi.';
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
    if (this.manager) this.onConnection(null);
    this.manager?.dispose();
    this.manager = null;
    this.detachLink()?.close();
    this.peerLeft = false;
    this.preVerified = null;
    this.resolveRequest?.(false);
    this.resolveRequest = null;
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
        manager.saveFolder = () => this.saveFolder();
        manager.onChange = (transfers) => this.set({ transfers });
        manager.onText = (message) => this.set({ messages: [...this.state.messages, message] });
        manager.onPeerInfo = (peer) => {
          this.set({ peerName: peer.name, peer });
          this.judge();
        };
        manager.onRecord = (record) => {
          const { peer, peerName, method } = this.state;
          this.onRecord(record, { peer, peerName, method });
        };
        manager.onPeerLeft = () => {
          this.peerLeft = true;
        };
        this.manager = manager;
        this.onConnection({ link, manager });
        this.set({ linkState, error, wasConnected: true });
        const { method, role, pairCode } = this.state;
        if (method === 'code' && role && pairCode) rooms.remember(pairCode, role);
        this.startVerification(link, manager);
        return;
      }
      if (linkState === 'failed' && this.state.wasConnected) {
        const message = this.peerLeft ? 'Karşı cihaz oturumu kapattı.' : (error ?? 'Bağlantı koptu.');
        this.manager?.handleDisconnect(message);
        this.onConnection(null);
        this.set({ linkState, error: message });
        return;
      }
      this.set({ linkState, error });
    };
    return link;
  }

  // ---------------------------------------------------------------------------
  // Verification (lib/webrtc/verify, lib/storage/trusted)
  // ---------------------------------------------------------------------------

  private startVerification(link: PeerLink, manager: TransferManager): void {
    const local = link.localFingerprint;
    const remote = link.remoteFingerprint;
    // Every browser SDP has a fingerprint; without one there is nothing to verify against.
    if (!local || !remote) return this.set({ verify: 'failed' });
    const current = () => this.manager === manager;
    const exchange = new SasExchange(local, remote, (msg) => manager.sendSas(msg));
    exchange.onCode = (code) => {
      if (!current()) return;
      this.set({ pairingCode: code });
      this.judge();
    };
    exchange.onFail = () => current() && this.set({ verify: 'failed' });
    manager.onSas = (msg) => void exchange.handle(msg);
    manager.onHello = (version) => {
      if (current() && version < PROTOCOL_VERSION) this.set({ peerOutdated: true });
    };
    manager.onPeerVerified = () => current() && this.set({ peerVerified: true });
    void exchange.start();
    this.judge();
  }

  /** Re-evaluates the verification state as the fingerprint, hello and code come in. */
  private judge(): void {
    const { link, manager } = this;
    const fingerprint = link?.remoteFingerprint;
    if (!manager || !fingerprint) return;
    const { verify, peer, pairingCode } = this.state;
    if (verify === 'failed') return;
    if (verify === 'verified') {
      // Its hello may come after the verification: keep its current name in the list.
      if (peer) trusted.trust(fingerprint, peer);
      return;
    }
    if (this.preVerified) return this.markVerified(this.preVerified);
    const judgement = judgeTrust(trusted.getSnapshot(), fingerprint, peer);
    if (judgement.kind === 'known') return this.markVerified('trusted');
    this.set({
      verify: judgement.kind === 'changed' ? 'changed' : pairingCode ? 'unverified' : 'checking',
      lookalike: judgement.kind === 'changed' ? judgement.device : (judgement.sameName ?? null),
    });
  }

  private markVerified(by: VerifiedBy): void {
    const fingerprint = this.link?.remoteFingerprint;
    if (!this.manager || !fingerprint) return;
    trusted.trust(fingerprint, this.state.peer);
    this.set({ verify: 'verified', verifiedBy: by, lookalike: null });
    this.manager.setVerified();
  }
}

export const session = new Session();

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
