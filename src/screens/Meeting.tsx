import { useEffect, useRef, useState, type RefObject } from 'react';
import { session, useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { ink, useInk } from '../hooks/useInk';
import { popout, usePopout } from '../hooks/usePopout';
import { saving } from '../hooks/useSaving';
import { useProfile } from '../hooks/useProfile';
import { formatDuration } from '../lib/format';
import { drawStrokes, type Surface } from '../lib/ink';
import { describeStats, StreamVideo, useStreamStats } from '../components/ScreenShare';
import { InkLayer } from '../components/InkLayer';
import { InkToolbar } from '../components/InkToolbar';
import { ChatPanel } from '../components/ChatPanel';
import { Icon, type IconName } from '../components/Icon';
import { VerifyBadge } from '../components/Verify';

type VideoRefs = Record<Surface, RefObject<HTMLVideoElement | null>>;

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * The screen-share "meeting": one screen on the stage (the other side's, or
 * ours while only we share), the other as a tile you can swap in, drawings on
 * top, a control bar below and the chat beside it.
 */
export function Meeting() {
  const { local, remote, remoteAudio, soundOn, localSince, remoteSince, supported } = useScreenShare();
  const { peerName, linkState, messages } = useSession();
  const { active: drawing } = useInk();
  const quality = useProfile().settings.screenQuality;
  const popoutWin = usePopout();
  const meetRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const videoRefs: VideoRefs = { local: localRef, remote: remoteRef };
  const [focus, setFocus] = useState<Surface>('remote');
  const [chatOpen, setChatOpen] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ file: File; url: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const connected = linkState === 'connected';
  const name = peerName ?? 'Karşı cihaz';

  const main: Surface = remote && (focus === 'remote' || !local) ? 'remote' : 'local';
  const tile: Surface | null = local && remote ? (main === 'remote' ? 'local' : 'remote') : null;
  const stats = useStreamStats(main === 'remote' ? 'in' : 'out', true);
  const since = main === 'remote' ? remoteSince : localSince;

  // Unread messages while the chat is hidden, and a peek at the newest one.
  const incoming = messages.filter((m) => m.direction === 'in');
  const [seen, setSeen] = useState(incoming.length);
  const unread = chatOpen ? 0 : incoming.length - seen;
  const latest = incoming.at(-1);
  const [peekId, setPeekId] = useState<string | null>(null);
  useEffect(() => {
    if (chatOpen) setSeen(incoming.length);
    else if (latest && incoming.length > seen) setPeekId(latest.id);
  }, [chatOpen, incoming.length]);
  useEffect(() => {
    if (!peekId) return;
    const timer = setTimeout(() => setPeekId(null), 5000);
    return () => clearTimeout(timer);
  }, [peekId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === meetRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Keyboard: D draws, Esc stops drawing, Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        ink.undo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'd') {
        ink.setActive(!ink.getSnapshot().active);
      } else if (e.key === 'Escape' && ink.getSnapshot().active) {
        ink.setActive(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Free the snapshot preview when it's replaced or the meeting ends.
  useEffect(() => {
    if (!snapshot) return;
    return () => URL.revokeObjectURL(snapshot.url);
  }, [snapshot]);

  const canFullscreen = document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
  const canVideoPip = document.pictureInPictureEnabled === true;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    if (document.fullscreenEnabled && meetRef.current) return void meetRef.current.requestFullscreen().catch(() => {});
    // iPhone: only a video element can go full screen.
    (videoRefs[main].current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };

  const togglePopout = async () => {
    if (popout.supported) {
      if (popoutWin) return popout.close();
      if (!(await popout.open())) setNotice('Açılır pencere açılamadı.');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRefs[main].current?.requestPictureInPicture();
    } catch {
      setNotice('Resim içinde resim açılamadı.');
    }
  };

  /** The frame on stage plus its drawings, as a PNG. */
  const takeSnapshot = async () => {
    const video = videoRefs[main].current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    drawStrokes(ctx, ink.getSnapshot().strokes[main], { x: 0, y: 0, w: canvas.width, h: canvas.height });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return setNotice('Ekran görüntüsü alınamadı.');
    const file = new File([blob], snapshotName(), { type: 'image/png' });
    setSnapshot({ file, url: URL.createObjectURL(file) });
  };

  const saveSnapshot = async () => {
    if (!snapshot) return;
    const error = await saving.saveFile(snapshot.file);
    setNotice(error ?? 'Ekran görüntüsü kaydedildi.');
    if (!error) setSnapshot(null);
  };

  const sendSnapshot = () => {
    if (!snapshot) return;
    const error = session.sendFiles([snapshot.file]);
    setNotice(error ?? `Gönderildi; ${name} onaylayınca iletilir.`);
    if (!error) setSnapshot(null);
  };

  const title = main === 'remote' ? `${name} ekranı` : 'Ekranınızı sunuyorsunuz';
  const statsText = describeStats(stats);
  const peek = !chatOpen && peekId ? incoming.find((m) => m.id === peekId) : undefined;

  return (
    <div ref={meetRef} className={`meet rise${chatOpen ? ' with-chat' : ''}${fullscreen ? ' full' : ''}${main === 'local' ? ' presenting' : ''}`} data-testid="meeting">
      <header className="glass meet-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="grow meet-title">
          <strong className="block">{title}</strong>
          <span className="small muted tabular">
            {formatDuration(now - (since ?? now))}
            {statsText && ` · ${statsText}`}
          </span>
        </span>
        <span className="meet-people" aria-label="Katılımcılar">
          <span className="meet-person">{local ? 'Siz · sunuyor' : 'Siz'}</span>
          <span className="meet-person">{remote ? `${name} · sunuyor` : name}</span>
        </span>
        <VerifyBadge />
      </header>

      <div className="meet-body">
        <div className="meet-main">
          <div className={`meet-stage${drawing ? ' drawing' : ''}`} onDoubleClick={!drawing && canFullscreen ? toggleFullscreen : undefined}>
            {remote && (
              <SurfaceView surface="remote" stream={remote} videoRef={remoteRef} role={main === 'remote' ? 'main' : 'tile'} label={name} muted={!remoteAudio || !soundOn} onSelect={() => setFocus('remote')} />
            )}
            {local && (
              <SurfaceView surface="local" stream={local} videoRef={localRef} role={main === 'local' ? 'main' : 'tile'} label="Siz" muted onSelect={() => setFocus('local')} />
            )}
            {main === 'local' && !tile && <p className="meet-banner">Karşı taraf ekranınızı görüyor. Çizimleri ve lazeri burada görürsünüz.</p>}
            {notice && (
              <p className="meet-notice" role="status">
                {notice}
              </p>
            )}
            {peek && (
              <button type="button" className="meet-peek" onClick={() => setChatOpen(true)}>
                <Icon name="chat" />
                <span className="ellipsis">
                  <strong>{name}:</strong> {peek.text}
                </span>
              </button>
            )}
          </div>

          {snapshot && (
            <div className="glass snap-card" data-testid="snapshot-card">
              <img src={snapshot.url} alt="Alınan ekran görüntüsü" />
              <div className="snap-actions">
                <button type="button" className="btn small" onClick={() => void saveSnapshot()} data-testid="snapshot-save">
                  <Icon name="arrowDown" /> Kaydet
                </button>
                <button type="button" className="btn small primary" onClick={sendSnapshot} disabled={!connected} data-testid="snapshot-send">
                  <Icon name="send" /> Gönder
                </button>
                <button type="button" className="link" onClick={() => setSnapshot(null)} aria-label="Ekran görüntüsünü kapat">
                  <Icon name="close" />
                </button>
              </div>
            </div>
          )}

          {drawing && <InkToolbar surface={main} />}

          <nav className="glass meet-bar" aria-label="Paylaşım kontrolleri">
            <BarButton icon="draw" label="Çiz" active={drawing} onClick={() => ink.setActive(!drawing)} title="Çiz (D)" testId="ink-toggle" />
            {main === 'remote' && remoteAudio && (
              <BarButton icon={soundOn ? 'volume' : 'muted'} label={soundOn ? 'Ses' : 'Sessiz'} active={!soundOn} onClick={() => screenShare.setSoundOn(!soundOn)} testId="screen-sound" />
            )}
            <BarButton icon="camera" label="Görüntü al" onClick={() => void takeSnapshot()} testId="screen-snapshot" />
            {tile && <BarButton icon="swap" label="Değiş" onClick={() => setFocus(tile)} title="Sahnedeki ekranı değiştir" />}
            {local && (
              <BarButton
                icon="hd"
                label={quality === 'detail' ? 'Net' : 'Akıcı'}
                onClick={() => screenShare.setQuality(quality === 'detail' ? 'motion' : 'detail')}
                title={quality === 'detail' ? 'Kalite: Net (yazı keskin). Akıcı’ya geç' : 'Kalite: Akıcı (60 fps). Net’e geç'}
                testId="screen-quality"
              />
            )}
            {(popout.supported || canVideoPip) && (
              <BarButton icon="popout" label="Pencere" active={popoutWin !== null} onClick={() => void togglePopout()} title="Her zaman üstte duran pencerede aç" testId="screen-popout" />
            )}
            {canFullscreen && <BarButton icon="fullscreen" label={fullscreen ? 'Küçült' : 'Tam ekran'} active={fullscreen} onClick={toggleFullscreen} />}
            <BarButton icon="chat" label="Sohbet" active={chatOpen} badge={unread} onClick={() => setChatOpen(!chatOpen)} testId="chat-toggle" />
            <span className="meet-bar-sep" aria-hidden="true" />
            {local ? (
              <>
                <BarButton icon="resend" label="Değiştir" onClick={() => void screenShare.share()} title="Başka bir pencere ya da ekran seç" testId="screen-switch" />
                <BarButton icon="stop" label="Durdur" tone="danger" onClick={() => screenShare.stop()} testId="screen-stop" />
              </>
            ) : (
              supported && <BarButton icon="screen" label="Paylaş" tone="primary" disabled={!connected} onClick={() => void screenShare.share()} title="Siz de ekranınızı paylaşın" testId="screen-share" />
            )}
          </nav>
        </div>

        {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      </div>
    </div>
  );
}

interface SurfaceProps {
  surface: Surface;
  stream: MediaStream;
  videoRef: RefObject<HTMLVideoElement | null>;
  role: 'main' | 'tile';
  label: string;
  muted: boolean;
  onSelect?: () => void;
}

/** One shared screen with its drawings: on stage (`main`) or as the small tile. */
export function SurfaceView({ surface, stream, videoRef, role, label, muted, onSelect }: SurfaceProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <div
      className={`meet-surface ${role}`}
      data-testid={surface === 'remote' ? 'remote-screen' : 'local-screen'}
      data-ready={size !== null}
      data-size={size ? `${size.width}x${size.height}` : ''}
    >
      <StreamVideo
        stream={stream}
        videoRef={videoRef}
        muted={muted}
        onSize={(width, height) => setSize({ width, height })}
        {...(surface === 'remote' ? { onAutoMuted: () => screenShare.setSoundOn(false) } : {})}
      />
      <InkLayer surface={surface} videoRef={videoRef} interactive={role === 'main'} />
      {!size && (
        <div className="screen-wait" role="status">
          <span className="mini-spinner" aria-hidden="true" />
          Görüntü bekleniyor…
        </div>
      )}
      <span className="surface-label">{label}</span>
      {role === 'tile' && onSelect && <button type="button" className="surface-select" onClick={onSelect} aria-label={`${label} ekranını sahneye al`} />}
    </div>
  );
}

function BarButton({ icon, label, onClick, active = false, disabled = false, tone, badge = 0, title, testId }: {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
  badge?: number;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`meet-btn${active ? ' active' : ''}${tone ? ` ${tone}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={tone ? undefined : active}
      aria-label={title ?? label}
      title={title ?? label}
      data-testid={testId}
    >
      <span className="meet-btn-icon">
        <Icon name={icon} />
        {badge > 0 && <span className="badge">{badge > 9 ? '9+' : badge}</span>}
      </span>
      <span className="meet-btn-label">{label}</span>
    </button>
  );
}

/** ekran-2026-10-26-14.32.05.png (local time, sorts by name). */
function snapshotName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `ekran-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}
