import { useSyncExternalStore } from 'react';
import { canCaptureScreen, captureScreen, MediaLink, type ScreenQuality, type StreamStats } from '../lib/webrtc/media';
import { session } from './useSession';
import { profile } from './useProfile';
import { ink } from './useInk';

export interface ScreenSnapshot {
  /** This browser can share its screen. Viewing works everywhere. */
  supported: boolean;
  /** Our shared screen, while sharing. */
  local: MediaStream | null;
  localSince: number | null;
  /** The other side's screen, from the moment it announces sharing (tracks may still be on their way). */
  remote: MediaStream | null;
  remoteAudio: boolean;
  /** Play the other side's sound (off when the browser blocked autoplay with sound, or the user muted it). */
  soundOn: boolean;
  /** Changes with every new share from the other side (keys "hide the mini player" etc.). */
  remoteSince: number | null;
  /** The other side asked to see our screen. */
  asked: boolean;
  /** We asked to see theirs: 'waiting' for an answer, or why it won't come. */
  request: 'waiting' | 'declined' | 'unsupported' | null;
  error: string | null;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Screen sharing for the current connection: owns its MediaLink (created when
 * a connection comes up, dropped with it) and the share's UI state.
 */
class ScreenStore {
  private state: ScreenSnapshot = {
    supported: canCaptureScreen(),
    local: null,
    localSince: null,
    remote: null,
    remoteAudio: false,
    soundOn: true,
    remoteSince: null,
    asked: false,
    request: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private media: MediaLink | null = null;
  private requestTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    session.onConnection = (connection) => {
      this.media?.dispose();
      this.media = null;
      clearTimeout(this.requestTimer);
      this.set({ local: null, localSince: null, remote: null, remoteAudio: false, remoteSince: null, asked: false, request: null, error: null });
      ink.reset('local');
      ink.reset('remote');
      ink.setActive(false);
      ink.send = () => {};
      if (!connection) return;
      const { link, manager } = connection;
      const media = new MediaLink(link, {
        send: (msg) => manager.sendMedia(msg),
        onChange: () => this.media === media && this.sync(),
        onAsk: (msg) => {
          if (this.media !== media) return;
          if (msg.t === 'screen-no') {
            clearTimeout(this.requestTimer);
            this.set({ request: msg.unsupported ? 'unsupported' : 'declined' });
          } else if (!this.state.supported) {
            manager.sendMedia({ t: 'screen-no', unsupported: true });
          } else if (!media.local) {
            this.set({ asked: true });
          }
        },
      });
      media.quality = profile.getSnapshot().settings.screenQuality;
      ink.send = (msg) => manager.sendMedia(msg);
      manager.onMedia = (msg) => (msg.t === 'ink' || msg.t === 'point' ? ink.receive(msg) : media.handle(msg));
      this.media = media;
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<ScreenSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private sync(): void {
    const media = this.media;
    if (!media) return;
    const { local, remote } = media;
    const remoteStarted = remote !== null && this.state.remote === null;
    if (remoteStarted) clearTimeout(this.requestTimer);
    // A screen's drawings belong to that one share.
    if (local !== this.state.local) ink.reset('local');
    if (remoteStarted || (!remote && this.state.remote)) ink.reset('remote');
    if (!local && !remote) ink.setActive(false);
    this.set({
      local,
      localSince: local ? (this.state.local ? this.state.localSince : Date.now()) : null,
      remote,
      remoteAudio: media.remoteAudio,
      remoteSince: remote ? (remoteStarted ? Date.now() : this.state.remoteSince) : null,
      ...(remoteStarted ? { request: null } : {}),
      ...(local ? { asked: false } : {}),
    });
  }

  /** Opens the screen picker and starts sharing. Call directly from a click. */
  async share(): Promise<void> {
    if (!this.media || !this.state.supported) return;
    const gate = session.manager?.gateError;
    if (gate) return this.set({ error: gate });
    this.set({ error: null, asked: false });
    let stream: MediaStream;
    try {
      const { screenQuality, screenAudio } = profile.getSnapshot().settings;
      stream = await captureScreen(screenQuality, screenAudio);
    } catch (e) {
      const name = (e as DOMException).name;
      // Dismissed the picker (or the OS refused, which looks the same to the page).
      if (name === 'NotAllowedError' || name === 'AbortError') return;
      this.set({ error: 'Ekran paylaşımı başlatılamadı. Tarayıcı ya da işletim sistemi izin vermiyor olabilir.' });
      return;
    }
    if (!this.media) {
      // Disconnected while the picker was open.
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.media.share(stream);
  }

  stop(): void {
    this.media?.unshare();
  }

  /** Remembered in the profile; applies live to a running share. */
  setQuality(quality: ScreenQuality): void {
    void profile.updateSettings({ screenQuality: quality });
    void this.media?.setQuality(quality);
  }

  setSoundOn(soundOn: boolean): void {
    this.set({ soundOn });
  }

  setWithAudio(withAudio: boolean): void {
    void profile.updateSettings({ screenAudio: withAudio });
  }

  /** Asks the other side to share its screen. */
  ask(): void {
    if (!this.media || !session.manager) return;
    const gate = session.manager.gateError;
    if (gate) return this.set({ error: gate });
    session.manager.sendMedia({ t: 'screen-ask' });
    clearTimeout(this.requestTimer);
    this.requestTimer = setTimeout(() => this.state.request === 'waiting' && this.set({ request: null }), REQUEST_TIMEOUT_MS);
    this.set({ request: 'waiting' });
  }

  /** Turns down the other side's request. */
  decline(): void {
    session.manager?.sendMedia({ t: 'screen-no' });
    this.set({ asked: false });
  }

  dismissRequest(): void {
    this.set({ request: null });
  }

  dismissError(): void {
    this.set({ error: null });
  }

  stats(direction: 'in' | 'out'): Promise<StreamStats | null> {
    return this.media?.stats(direction) ?? Promise.resolve(null);
  }
}

export const screenShare = new ScreenStore();

export function useScreenShare(): ScreenSnapshot {
  return useSyncExternalStore(screenShare.subscribe, screenShare.getSnapshot);
}
