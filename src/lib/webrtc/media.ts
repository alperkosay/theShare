import type { MediaMessage } from '../transfer/protocol';
import type { PeerLink } from './peer';

/**
 * Screen sharing over the existing connection. The captured screen (video,
 * plus sound if shared) is added as tracks to the same RTCPeerConnection, and
 * the renegotiation that needs runs over the data channel with the "perfect
 * negotiation" pattern. Pairing (QR, code, nearby) therefore stays
 * data-channel-only, and the picture takes the same direct, DTLS-encrypted
 * path as the files: no server, no relay.
 *
 * Each side sends on its own sendonly transceivers, so both can share at the
 * same time. They are reused when sharing again, so the SDP doesn't grow.
 */

export type ScreenQuality = 'detail' | 'motion';

interface Preset {
  frameRate: number;
  maxBitrate: number;
  hint: 'detail' | 'motion';
  degradation: 'maintain-resolution' | 'maintain-framerate';
}

/**
 * detail: sharp text (documents, code, slides); under load the frame rate drops first.
 * motion: smooth video and animation; under load the resolution drops first.
 * Bitrates are caps for a good LAN; congestion control goes lower on slower paths.
 */
export const QUALITY: Record<ScreenQuality, Preset> = {
  detail: { frameRate: 30, maxBitrate: 6_000_000, hint: 'detail', degradation: 'maintain-resolution' },
  motion: { frameRate: 60, maxBitrate: 12_000_000, hint: 'motion', degradation: 'maintain-framerate' },
};

export interface StreamStats {
  width: number;
  height: number;
  fps: number;
  /** Bits per second since the previous call. */
  bitrate: number;
}

interface Callbacks {
  send: (msg: MediaMessage) => void;
  /** Local or remote stream changed. */
  onChange: () => void;
  /** The other side's answer to our request, or its request to see our screen. */
  onAsk: (msg: Extract<MediaMessage, { t: 'screen-ask' | 'screen-no' }>) => void;
}

type Kind = 'audio' | 'video';

export class MediaLink {
  /** Our captured screen while we share it. */
  local: MediaStream | null = null;
  /** The other side's screen: set when it announces sharing, filled as its tracks arrive. */
  remote: MediaStream | null = null;
  remoteAudio = false;
  quality: ScreenQuality = 'detail';

  private readonly pc: RTCPeerConnection;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  /** Incoming sdp/ice, applied one after another. */
  private queue: Promise<void> = Promise.resolve();
  private readonly transceivers = new Map<Kind, RTCRtpTransceiver>();
  private readonly lastBytes = new Map<string, { bytes: number; at: number }>();
  private disposed = false;

  constructor(
    link: PeerLink,
    private readonly cb: Callbacks,
  ) {
    this.pc = link.pc;
    // When both sides renegotiate at once, the one that answered the pairing offer gives way.
    this.polite = this.pc.localDescription?.type === 'answer';
    this.pc.addEventListener('negotiationneeded', this.onNegotiationNeeded);
    this.pc.addEventListener('icecandidate', this.onIceCandidate);
    this.pc.addEventListener('track', this.onTrack);
  }

  /** Starts sending a captured screen (from getDisplayMedia). Replaces a running share. */
  share(stream: MediaStream): void {
    if (this.disposed) return;
    if (this.local) this.unshare();
    this.local = stream;
    const audio = stream.getAudioTracks().length > 0;
    this.cb.send({ t: 'screen', on: true, ...(audio ? { audio: true } : {}) });
    const preset = QUALITY[this.quality];
    for (const track of stream.getTracks()) {
      const kind = track.kind as Kind;
      if (kind === 'video') track.contentHint = preset.hint;
      // The browser's own "Stop sharing" button ends the track.
      track.addEventListener('ended', this.onLocalEnded);
      const existing = this.transceivers.get(kind);
      try {
        if (existing) {
          void existing.sender.replaceTrack(track);
          existing.sender.setStreams?.(stream);
          existing.direction = 'sendonly';
        } else {
          const init: RTCRtpTransceiverInit = { direction: 'sendonly', streams: [stream] };
          if (kind === 'video') init.sendEncodings = [{ maxBitrate: preset.maxBitrate, maxFramerate: preset.frameRate }];
          this.transceivers.set(kind, this.pc.addTransceiver(track, init));
        }
      } catch (e) {
        console.warn('[theshare] could not add screen track', e);
      }
    }
    void this.applyQuality();
    this.cb.onChange();
  }

  /** Stops our share and tells the other side. */
  unshare(): void {
    const stream = this.local;
    if (!stream) return;
    this.local = null;
    stopTracks(stream, this.onLocalEnded);
    for (const t of this.transceivers.values()) {
      try {
        void t.sender.replaceTrack(null);
        t.direction = 'inactive';
      } catch {
        // Connection already closed.
      }
    }
    this.cb.send({ t: 'screen', on: false });
    this.cb.onChange();
  }

  /** Switches the quality preset, live if we're sharing. */
  async setQuality(quality: ScreenQuality): Promise<void> {
    this.quality = quality;
    await this.applyQuality();
  }

  handle(msg: MediaMessage): void {
    if (this.disposed) return;
    switch (msg.t) {
      case 'screen':
        this.remote = msg.on ? new MediaStream() : null;
        this.remoteAudio = msg.on && msg.audio === true;
        this.lastBytes.delete('inbound-rtp');
        this.cb.onChange();
        return;
      case 'screen-ask':
      case 'screen-no':
        this.cb.onAsk(msg);
        return;
      default:
        this.queue = this.queue
          .then(() => this.applySignal(msg))
          .catch((e: unknown) => console.warn('[theshare] screen renegotiation failed', e));
    }
  }

  /** Resolution, frame rate and bitrate of the video we receive ('in') or send ('out'). */
  async stats(direction: 'in' | 'out'): Promise<StreamStats | null> {
    const type = direction === 'in' ? 'inbound-rtp' : 'outbound-rtp';
    let report: RTCStatsReport;
    try {
      report = await this.pc.getStats();
    } catch {
      return null;
    }
    type Rtp = RTCStats & { kind?: string; bytesReceived?: number; bytesSent?: number; frameWidth?: number; frameHeight?: number; framesPerSecond?: number };
    const bytesOf = (r: Rtp) => (direction === 'in' ? r.bytesReceived : r.bytesSent) ?? 0;
    const streams: Rtp[] = [];
    report.forEach((s: RTCStats) => {
      if (s.type === type && (s as Rtp).kind === 'video') streams.push(s as Rtp);
    });
    // An earlier, now inactive share can leave a second entry; the busiest one is the live one.
    const r = streams.reduce<Rtp | null>((best, s) => (!best || bytesOf(s) > bytesOf(best) ? s : best), null);
    if (!r) return null;
    const bytes = bytesOf(r);
    const prev = this.lastBytes.get(type);
    this.lastBytes.set(type, { bytes, at: r.timestamp });
    const seconds = prev ? (r.timestamp - prev.at) / 1000 : 0;
    return {
      width: r.frameWidth ?? 0,
      height: r.frameHeight ?? 0,
      fps: Math.round(r.framesPerSecond ?? 0),
      bitrate: prev && seconds > 0 && bytes >= prev.bytes ? ((bytes - prev.bytes) * 8) / seconds : 0,
    };
  }

  /** The connection is gone: stop capturing and forget everything (sends nothing). */
  dispose(): void {
    this.disposed = true;
    this.pc.removeEventListener('negotiationneeded', this.onNegotiationNeeded);
    this.pc.removeEventListener('icecandidate', this.onIceCandidate);
    this.pc.removeEventListener('track', this.onTrack);
    if (this.local) stopTracks(this.local, this.onLocalEnded);
    this.local = null;
    this.remote = null;
  }

  // ---------------------------------------------------------------------------

  private readonly onLocalEnded = () => this.unshare();

  private readonly onNegotiationNeeded = async () => {
    if (this.disposed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const desc = this.pc.localDescription;
      if (desc?.type === 'offer' && !this.disposed) this.cb.send({ t: 'sdp', type: 'offer', sdp: desc.sdp });
    } catch (e) {
      console.warn('[theshare] could not create renegotiation offer', e);
    } finally {
      this.makingOffer = false;
    }
  };

  private readonly onIceCandidate = (e: RTCPeerConnectionIceEvent) => {
    // Media is bundled onto the existing transport, so normally there are none; trickle them just in case.
    if (!e.candidate?.candidate || this.disposed) return;
    this.cb.send({ t: 'ice', candidate: e.candidate.candidate, mid: e.candidate.sdpMid, index: e.candidate.sdpMLineIndex });
  };

  private readonly onTrack = (e: RTCTrackEvent) => {
    if (this.disposed) return;
    const tracks = this.remote?.getTracks() ?? [];
    if (tracks.includes(e.track)) return;
    // A new stream object, so a <video> showing it picks up the added track.
    this.remote = new MediaStream([...tracks, e.track]);
    this.cb.onChange();
  };

  private async applySignal(msg: Extract<MediaMessage, { t: 'sdp' | 'ice' }>): Promise<void> {
    if (this.disposed) return;
    if (msg.t === 'ice') {
      try {
        await this.pc.addIceCandidate({ candidate: msg.candidate, sdpMid: msg.mid, sdpMLineIndex: msg.index });
      } catch (e) {
        if (!this.ignoreOffer) throw e;
      }
      return;
    }
    const collision = msg.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    this.ignoreOffer = !this.polite && collision;
    if (this.ignoreOffer) return;
    // The polite side rolls its own pending offer back implicitly here.
    await this.pc.setRemoteDescription({ type: msg.type, sdp: msg.sdp });
    if (msg.type === 'offer') {
      await this.pc.setLocalDescription();
      const desc = this.pc.localDescription;
      if (desc && !this.disposed) this.cb.send({ t: 'sdp', type: 'answer', sdp: desc.sdp });
    }
  }

  private async applyQuality(): Promise<void> {
    const preset = QUALITY[this.quality];
    const track = this.local?.getVideoTracks()[0];
    const sender = this.transceivers.get('video')?.sender;
    if (!track || !sender) return;
    track.contentHint = preset.hint;
    try {
      await track.applyConstraints({ frameRate: { ideal: preset.frameRate } });
    } catch {
      // Not every capture source can change its frame rate; the encoder limits still apply.
    }
    try {
      const params = sender.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
      const encoding = params.encodings?.[0];
      if (!encoding) return;
      encoding.maxBitrate = preset.maxBitrate;
      encoding.maxFramerate = preset.frameRate;
      params.degradationPreference = preset.degradation;
      await sender.setParameters(params);
    } catch {
      // Some browsers refuse parts of this (e.g. degradationPreference); the defaults are fine.
    }
  }
}

function stopTracks(stream: MediaStream, onEnded: () => void): void {
  for (const track of stream.getTracks()) {
    track.removeEventListener('ended', onEnded);
    track.stop();
  }
}

/** This browser can capture its screen (desktop browsers; not iOS or Android). */
export function canCaptureScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Opens the browser's screen picker; call from a click. Rejects with NotAllowedError if dismissed. */
export function captureScreen(quality: ScreenQuality, audio: boolean): Promise<MediaStream> {
  // The Chromium hints: offer to switch to another tab mid-share, don't list this
  // tab (sharing theShare itself makes no sense), allow whole-system sound.
  const options = {
    video: { frameRate: { ideal: QUALITY[quality].frameRate } },
    audio,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: audio ? 'include' : 'exclude',
  } as DisplayMediaStreamOptions;
  return navigator.mediaDevices.getDisplayMedia(options);
}
