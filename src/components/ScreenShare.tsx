import { useEffect, useRef, useState, type RefObject } from 'react';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { useSession } from '../hooks/useSession';
import type { StreamStats } from '../lib/webrtc/media';
import { formatBitrate } from '../lib/format';
import { Icon } from './Icon';

interface VideoProps {
  stream: MediaStream;
  muted: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  className?: string;
  /** Size of the picture once frames arrive (and whenever it changes). */
  onSize?: (width: number, height: number) => void;
  /** The browser refused to autoplay with sound, so it plays muted. */
  onAutoMuted?: () => void;
}

/** A <video> showing a live stream (srcObject has no attribute form, so it's set here). */
export function StreamVideo({ stream, muted, videoRef, className, onSize, onAutoMuted }: VideoProps) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;
  const autoMuted = useRef(onAutoMuted);
  autoMuted.current = onAutoMuted;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = muted;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {
      if (video.muted) return;
      video.muted = true;
      autoMuted.current?.();
      void video.play().catch(() => {});
    });
  }, [ref, stream, muted]);

  const report = () => {
    const video = ref.current;
    if (video?.videoWidth) onSize?.(video.videoWidth, video.videoHeight);
  };

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} onLoadedMetadata={report} onResize={report} />;
}

/** Polls the stats of the video we receive or send, once a second while `active`. */
export function useStreamStats(direction: 'in' | 'out', active: boolean): StreamStats | null {
  const [stats, setStats] = useState<StreamStats | null>(null);
  useEffect(() => {
    setStats(null);
    if (!active) return;
    let alive = true;
    const tick = () => void screenShare.stats(direction).then((s) => alive && setStats(s));
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [direction, active]);
  return stats;
}

export function describeStats(stats: StreamStats | null): string | null {
  if (!stats?.width) return null;
  const parts = [`${stats.width}×${stats.height}`];
  if (stats.fps) parts.push(`${stats.fps} fps`);
  if (stats.bitrate) parts.push(formatBitrate(stats.bitrate));
  return parts.join(' · ');
}

export function LivePill() {
  return (
    <span className="live-pill">
      <span className="live-dot" aria-hidden="true" />
      Canlı
    </span>
  );
}

/**
 * The other side's screen in a small floating player while another tab is
 * open, so watching doesn't stop when you go send a file. Tap opens the
 * Screen tab; the X hides it until their next share.
 */
export function ScreenMini({ onOpen }: { onOpen: () => void }) {
  const { remote, remoteSince, remoteAudio, soundOn } = useScreenShare();
  const { peerName } = useSession();
  const [hiddenFor, setHiddenFor] = useState<number | null>(null);
  if (!remote || hiddenFor === remoteSince) return null;
  return (
    <div className="screen-mini" data-testid="screen-mini">
      <button type="button" className="screen-mini-open" onClick={onOpen} aria-label={`${peerName ?? 'Karşı cihaz'} ekranını aç`}>
        <StreamVideo stream={remote} muted={!remoteAudio || !soundOn} onAutoMuted={() => screenShare.setSoundOn(false)} />
        <LivePill />
      </button>
      <button type="button" className="screen-mini-close" onClick={() => setHiddenFor(remoteSince)} aria-label="Küçük oynatıcıyı gizle">
        <Icon name="close" />
      </button>
    </div>
  );
}

/** The other side asked to see our screen. "Paylaş" opens the picker right from the click. */
export function ScreenAskPrompt({ onShare }: { onShare: () => void }) {
  const { asked } = useScreenShare();
  const { peerName } = useSession();
  if (!asked) return null;
  return (
    <div className="toast screen-ask" role="alertdialog" aria-label="Ekran paylaşma isteği" data-testid="screen-asked">
      <span className="avatar small-avatar">
        <Icon name="screen" />
      </span>
      <span>
        <strong>{peerName ?? 'Karşı cihaz'}</strong> ekranınızı görmek istiyor
      </span>
      <button
        type="button"
        className="btn small primary"
        onClick={() => {
          onShare();
          void screenShare.share();
        }}
        data-testid="screen-ask-accept"
      >
        Paylaş
      </button>
      <button type="button" className="link" onClick={() => screenShare.decline()} data-testid="screen-ask-decline">
        Hayır
      </button>
    </div>
  );
}
