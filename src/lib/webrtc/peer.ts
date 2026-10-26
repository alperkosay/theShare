import { decodeSignal, encodeSignal, sdpFingerprint, SignalError, type SessionDescription } from './signal-codec';
import { deviceCertificate } from './identity';

/**
 * One RTCPeerConnection + one data channel, with manual (copy/QR) signaling.
 *
 * Non-trickle ICE: we wait for gathering to finish so a single offer/answer
 * carries every candidate. Swapping in trickle ICE or another signaling
 * transport later only touches this file — the rest of the app talks to
 * `PeerLink` and never sees SDP.
 */

export type LinkState =
  | 'idle'
  | 'gathering' // creating our description, collecting ICE candidates
  | 'waiting-answer' // host: offer shown, waiting for the answer code
  | 'waiting-peer' // joiner: answer shown, waiting for the host to apply it
  | 'connecting' // both descriptions set, ICE/DTLS in progress
  | 'connected' // data channel open
  | 'failed'
  | 'closed';

/**
 * STUN lets each side learn its public address so devices on different
 * networks can reach each other directly. Used only by the pairing methods
 * that go online anyway (code, nearby); the offline QR flow never contacts
 * anything outside the LAN. The STUN server sees the public IP (see README).
 * No TURN: when NATs forbid a direct path (common between two phones on
 * mobile data), the connection fails rather than relaying files via a server.
 */
export const STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

export interface LinkOptions {
  /** Use STUN so devices on different networks can connect. */
  remote?: boolean;
}

const ICE_GATHERING_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 30_000;
const WAIT_PEER_TIMEOUT_MS = 5 * 60_000;
const RECOVER_TIMEOUT_MS = 90_000;
const DISCONNECT_GRACE_MS = 8_000;

const MSG_LOCAL_FAILED =
  'İki cihazın aynı Wi-Fi ağında olduğundan emin olun. Misafir ağlarında çalışmayabilir; telefonun hotspot\'u genelde işe yarar.';
const MSG_REMOTE_FAILED =
  'Cihazlar arasında doğrudan bağlantı kurulamadı. Bazı mobil ağlar ve güvenlik duvarları buna izin vermez; mümkünse iki cihazı aynı Wi-Fi ağına bağlayıp tekrar deneyin.';

export class PeerLink {
  readonly pc: RTCPeerConnection;
  readonly channel: RTCDataChannel;
  state: LinkState = 'idle';
  error: string | null = null;

  onStateChange: (state: LinkState, error: string | null) => void = () => {};
  onMessage: (data: string | ArrayBuffer) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly connectFailedMessage: string;

  constructor({ remote = false }: LinkOptions = {}) {
    const certificate = deviceCertificate();
    this.pc = new RTCPeerConnection({
      iceServers: remote ? [{ urls: STUN_SERVERS }] : [],
      ...(certificate ? { certificates: [certificate] } : {}),
    });
    this.connectFailedMessage = remote ? MSG_REMOTE_FAILED : MSG_LOCAL_FAILED;
    // Pre-negotiated channel: same id on both sides, no ondatachannel round-trip.
    this.channel = this.pc.createDataChannel('theshare', { negotiated: true, id: 0, ordered: true });
    this.channel.binaryType = 'arraybuffer';

    this.channel.onopen = () => this.setState('connected');
    this.channel.onclose = () => {
      if (this.state === 'connected') this.fail('Bağlantı kapandı. Karşı taraf oturumu bitirmiş ya da bağlantı kopmuş olabilir.');
    };
    this.channel.onmessage = (e: MessageEvent<string | ArrayBuffer>) => this.onMessage(e.data);

    this.pc.onconnectionstatechange = () => this.handleConnectionState(this.pc.connectionState);
    // Fallback for browsers with incomplete connectionState support.
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.handleConnectionState('failed');
    };
  }

  /** Host step 1: returns the offer payload to show as QR / text. */
  async createOffer(): Promise<string> {
    this.setState('gathering');
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const payload = await this.exportLocal();
      this.setState('waiting-answer');
      return payload;
    } catch (e) {
      throw this.fail(errorMessage(e, 'Davet kodu oluşturulamadı.'));
    }
  }

  /** Host step 2: apply the answer pasted/scanned from the joiner. */
  async acceptAnswer(input: string): Promise<void> {
    const desc = await decodeSignal(input, 'answer'); // SignalError → caller shows it, link stays usable
    if (this.pc.signalingState !== 'have-local-offer') {
      throw new SignalError('Bu davet için zaten bir yanıt uygulandı. Yeniden bağlanmak için baştan başlayın.');
    }
    try {
      await this.pc.setRemoteDescription(desc);
    } catch (e) {
      throw new SignalError(errorMessage(e, 'Yanıt kodu bu cihaz tarafından kabul edilmedi.'));
    }
    if (this.state !== 'connected') {
      this.setState('connecting');
      this.startTimer(CONNECT_TIMEOUT_MS, this.connectFailedMessage);
    }
  }

  /** Joiner: apply the host's offer and return our answer payload. */
  async acceptOffer(input: string): Promise<string> {
    const desc = await decodeSignal(input, 'offer');
    this.setState('gathering');
    try {
      await this.pc.setRemoteDescription(desc);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      const payload = await this.exportLocal();
      if (this.state === 'gathering') {
        this.setState('waiting-peer');
        this.startTimer(
          WAIT_PEER_TIMEOUT_MS,
          'Karşı cihaz yanıt kodunu zamanında okutmadı. Baştan başlayıp tekrar deneyin.',
        );
      }
      return payload;
    } catch (e) {
      throw this.fail(errorMessage(e, 'Davet kodu bu cihazda açılamadı.'));
    }
  }

  sendText(text: string): void {
    this.channel.send(text);
  }

  sendBinary(data: Uint8Array<ArrayBuffer>): void {
    this.channel.send(data);
  }

  /** Effective max message size negotiated over SCTP (0 if unknown). */
  get maxMessageSize(): number {
    return this.pc.sctp?.maxMessageSize ?? 0;
  }

  get localSdp(): string {
    return this.pc.localDescription?.sdp ?? '';
  }

  get remoteSdp(): string {
    return this.pc.remoteDescription?.sdp ?? '';
  }

  /** DTLS certificate fingerprints (sha-256, "AB:CD:…"); the remote one is what DTLS verified. */
  get localFingerprint(): string | null {
    return sdpFingerprint(this.localSdp);
  }

  get remoteFingerprint(): string | null {
    return sdpFingerprint(this.remoteSdp);
  }

  /** Candidate pair actually in use, e.g. "host ↔ host" (diagnostics only). */
  async selectedPair(): Promise<{ local: string; remote: string } | null> {
    try {
      const stats = await this.pc.getStats();
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach((s: RTCStats) => {
        if (s.type === 'transport') {
          const id = (s as RTCTransportStats).selectedCandidatePairId;
          if (id) pair = stats.get(id) as RTCIceCandidatePairStats | undefined;
        }
      });
      if (!pair) {
        stats.forEach((s: RTCStats) => {
          const p = s as RTCIceCandidatePairStats & { selected?: boolean };
          if (s.type === 'candidate-pair' && (p.selected || (p.nominated && p.state === 'succeeded'))) pair ??= p;
        });
      }
      if (!pair) return null;
      const describe = (id: string) => {
        const c = stats.get(id) as { candidateType?: string; address?: string; port?: number } | undefined;
        return c ? `${c.candidateType ?? '?'} ${c.address ?? ''}:${c.port ?? ''}` : '?';
      };
      return { local: describe(pair.localCandidateId), remote: describe(pair.remoteCandidateId) };
    } catch {
      return null;
    }
  }

  close(): void {
    this.clearTimers();
    this.channel.onclose = null;
    this.channel.close();
    this.pc.close();
    if (this.state !== 'failed') this.setState('closed');
  }

  // -------------------------------------------------------------------------

  private async exportLocal(): Promise<string> {
    await waitForIceGathering(this.pc, ICE_GATHERING_TIMEOUT_MS);
    const local = this.pc.localDescription;
    if (!local) throw new SignalError('Yerel bağlantı bilgisi oluşturulamadı.');
    return encodeSignal({ type: local.type, sdp: local.sdp } as SessionDescription);
  }

  private handleConnectionState(state: RTCPeerConnectionState): void {
    if (state === 'failed') {
      // The joiner starts connectivity checks as soon as its answer exists, but the
      // host only answers them after the user has scanned that answer. Some ICE
      // agents give up in the meantime and recover once the host's checks arrive,
      // so don't treat this as fatal yet — just shorten the remaining wait.
      if (this.state === 'waiting-peer') {
        this.startTimer(RECOVER_TIMEOUT_MS, this.connectFailedMessage);
        return;
      }
      this.fail(this.connectFailedMessage);
    } else if (state === 'disconnected') {
      // Often transient (Wi-Fi roaming, phone screen briefly off); give it a moment.
      clearTimeout(this.graceTimer);
      this.graceTimer = setTimeout(() => {
        if (this.pc.connectionState === 'disconnected') this.fail('Bağlantı koptu. Cihazların aynı ağda ve ekranlarının açık olduğundan emin olun.');
      }, DISCONNECT_GRACE_MS);
    } else if (state === 'connected') {
      clearTimeout(this.graceTimer);
    }
  }

  private startTimer(ms: number, message: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.state !== 'connected') this.fail(message);
    }, ms);
  }

  private clearTimers(): void {
    clearTimeout(this.timer);
    clearTimeout(this.graceTimer);
  }

  private setState(state: LinkState): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    if (state === 'connected') this.clearTimers();
    this.state = state;
    this.onStateChange(state, this.error);
  }

  private fail(message: string): Error {
    if (this.state !== 'failed' && this.state !== 'closed') {
      this.error = message;
      this.state = 'failed';
      this.clearTimers();
      this.channel.onclose = null;
      this.pc.close();
      this.onStateChange('failed', message);
    }
    return new Error(message);
  }
}

/**
 * Resolves when ICE gathering is complete, or after `timeoutMs` if at least
 * one candidate was found (e.g. an unreachable STUN server would otherwise
 * stall gathering for a long time).
 */
export function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let candidates = 0;
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onState);
      pc.removeEventListener('icecandidate', onCandidate);
    };
    const onState = () => {
      if (pc.iceGatheringState === 'complete') {
        done();
        resolve();
      }
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (e.candidate) {
        candidates++;
        return;
      }
      // A null candidate also marks the end of gathering (some Safari versions skip the state event).
      done();
      resolve();
    };
    const timer = setTimeout(() => {
      done();
      if (candidates > 0) resolve();
      else reject(new SignalError('Ağ bilgisi toplanamadı. Cihazın bir ağa bağlı olduğundan emin olun.'));
    }, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onState);
    pc.addEventListener('icecandidate', onCandidate);
  });
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof SignalError ? e.message : fallback;
}
