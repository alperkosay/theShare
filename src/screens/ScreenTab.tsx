import { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { saving } from '../hooks/useSaving';
import { formatDuration } from '../lib/format';
import { deviceLabel } from '../lib/device';
import type { ScreenQuality } from '../lib/webrtc/media';
import { NotConnected, PeerBar } from '../components/PeerBar';
import { describeStats, LivePill, StreamVideo, useStreamStats } from '../components/ScreenShare';
import { DeviceIcon, Icon } from '../components/Icon';

/** "Screen" tab: watch the other side's screen, share your own (both can share at once). */
export function ScreenTab({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { linkState, wasConnected } = useSession();
  const { remote, local, error } = useScreenShare();
  const connected = linkState === 'connected';

  if (!wasConnected) {
    return <NotConnected text="Ekranınızı paylaşmak ya da karşı cihazın ekranını izlemek için önce bir cihaza bağlanın." onConnect={onOpenDevices} />;
  }

  return (
    <>
      <PeerBar onOpen={onOpenDevices} />
      {error && (
        <p className="notice error" role="alert" onClick={() => screenShare.dismissError()}>
          {error}
        </p>
      )}
      {remote && <RemoteScreen stream={remote} />}
      {local ? <MyShare stream={local} /> : <ShareStart connected={connected} compact={remote !== null} />}
      {!remote && <PeerIdle connected={connected} />}
      <p className="small muted center screen-privacy">
        <Icon name="shield" /> Görüntü cihazlar arasında doğrudan ve şifreli gider; hiçbir sunucudan geçmez.
      </p>
    </>
  );
}

// -----------------------------------------------------------------------------
// Watching
// -----------------------------------------------------------------------------

function RemoteScreen({ stream }: { stream: MediaStream }) {
  const { peerName } = useSession();
  const { remoteAudio, soundOn } = useScreenShare();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stats = useStreamStats('in', true);
  const ready = size !== null;

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const on = () => setPip(true);
    const off = () => setPip(false);
    video.addEventListener('enterpictureinpicture', on);
    video.addEventListener('leavepictureinpicture', off);
    return () => {
      video.removeEventListener('enterpictureinpicture', on);
      video.removeEventListener('leavepictureinpicture', off);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const canFullscreen = document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype;
  const canPip = document.pictureInPictureEnabled === true;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
    const stage = stageRef.current;
    if (document.fullscreenEnabled && stage) return void stage.requestFullscreen().catch(() => {});
    // iPhone: only the video element itself can go full screen.
    (videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch {
      setNotice('Resim içinde resim açılamadı.');
    }
  };

  const snapshot = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return setNotice('Ekran görüntüsü alınamadı.');
    const error = await saving.saveFile(new File([blob], snapshotName(), { type: 'image/png' }));
    setNotice(error ?? 'Ekran görüntüsü kaydedildi.');
  };

  const statsText = describeStats(stats);
  return (
    <section
      className="glass screen-view rise"
      aria-label={`${peerName ?? 'Karşı cihaz'} ekranı`}
      data-testid="remote-screen"
      data-ready={ready}
      data-size={size ? `${size.width}x${size.height}` : ''}
    >
      <div ref={stageRef} className={`screen-stage${fullscreen ? ' full' : ''}`} onDoubleClick={canFullscreen ? toggleFullscreen : undefined}>
        <StreamVideo
          stream={stream}
          videoRef={videoRef}
          muted={!remoteAudio || !soundOn}
          onSize={(width, height) => setSize({ width, height })}
          onAutoMuted={() => screenShare.setSoundOn(false)}
        />
        {!ready && (
          <div className="screen-wait" role="status">
            <span className="mini-spinner" aria-hidden="true" />
            Görüntü bekleniyor…
          </div>
        )}
        {pip && <div className="screen-wait">Resim içinde resim olarak oynatılıyor</div>}
        <LivePill />
        <div className="screen-tools">
          {remoteAudio && (
            <ToolButton
              icon={soundOn ? 'volume' : 'muted'}
              label={soundOn ? 'Sesi kapat' : 'Sesi aç'}
              active={!soundOn}
              onClick={() => screenShare.setSoundOn(!soundOn)}
              testId="screen-sound"
            />
          )}
          <ToolButton icon="camera" label="Ekran görüntüsü kaydet" disabled={!ready} onClick={() => void snapshot()} testId="screen-snapshot" />
          {canPip && <ToolButton icon="pip" label={pip ? 'Resim içinde resmi kapat' : 'Resim içinde resim'} active={pip} disabled={!ready} onClick={() => void togglePip()} />}
          {canFullscreen && <ToolButton icon="fullscreen" label={fullscreen ? 'Tam ekrandan çık' : 'Tam ekran'} onClick={toggleFullscreen} />}
        </div>
      </div>
      <div className="screen-caption">
        <span className="block">
          <strong>{peerName ?? 'Karşı cihaz'}</strong> ekranını paylaşıyor
          {remoteAudio && !soundOn && <span className="muted"> · ses kapalı</span>}
        </span>
        {statsText && <span className="small muted block tabular">{statsText}</span>}
      </div>
      {notice && (
        <p className="notice small" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

function ToolButton({ icon, label, onClick, active = false, disabled = false, testId }: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button type="button" className={`screen-tool${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} title={label} data-testid={testId}>
      <Icon name={icon} />
    </button>
  );
}

/** ekran-2026-10-26-14.32.05.png (local time, sorts by name). */
function snapshotName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `ekran-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`;
}

/** The other side isn't sharing: say so compactly and offer to ask for it. */
function PeerIdle({ connected }: { connected: boolean }) {
  const { peerName, peer } = useSession();
  const { request } = useScreenShare();
  const name = peerName ?? 'Karşı cihaz';
  // Phone and tablet browsers can't capture their screen; don't offer a request that can't succeed.
  const peerCanShare = !peer || peer.kind === 'computer';

  let hint: string;
  if (request === 'declined') hint = `${name} şimdilik paylaşmak istemedi.`;
  else if (request === 'unsupported' || !peerCanShare) hint = `${peer ? deviceLabel(peer) : 'Karşı cihazın'} tarayıcısından ekran paylaşılamıyor.`;
  else if (request === 'waiting') hint = 'İstek gönderildi, onay bekleniyor…';
  else hint = 'Görmek için paylaşmasını isteyin.';

  return (
    <section className="glass screen-peer rise" data-testid="peer-idle">
      <span className="avatar">
        <DeviceIcon kind={peer?.kind ?? 'computer'} />
      </span>
      <span className="grow">
        <strong className="block">{name} ekran paylaşmıyor</strong>
        <span className="small muted" role="status">
          {hint}
        </span>
      </span>
      {peerCanShare && request !== 'unsupported' && (
        <button
          type="button"
          className="btn small"
          disabled={!connected || request === 'waiting'}
          onClick={() => screenShare.ask()}
          data-testid="screen-ask"
        >
          {request === 'waiting' ? <span className="mini-spinner" aria-hidden="true" /> : <Icon name="eye" />}
          İste
        </button>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Sharing
// -----------------------------------------------------------------------------

/** The big call to action; `compact` (while watching theirs) shrinks it to one row with the current settings. */
function ShareStart({ connected, compact }: { connected: boolean; compact: boolean }) {
  const { supported, withAudio } = useScreenShare();

  if (compact) {
    if (!supported) return null;
    return (
      <section className="glass screen-peer rise">
        <span className="avatar small-avatar">
          <Icon name="screen" />
        </span>
        <span className="grow">
          <strong className="block">Siz de paylaşın</strong>
          <span className="small muted">İki ekran aynı anda paylaşılabilir.</span>
        </span>
        <button type="button" className="btn small" disabled={!connected} onClick={() => void screenShare.share()} data-testid="screen-share">
          Paylaş
        </button>
      </section>
    );
  }

  if (!supported) {
    return (
      <section className="glass screen-peer rise">
        <span className="avatar">
          <Icon name="screen" />
        </span>
        <span className="grow">
          <strong className="block">Bu cihaz ekranını paylaşamıyor</strong>
          <span className="small muted">Telefon ve tablet tarayıcıları buna izin vermiyor. Bilgisayardan paylaşılan ekranı burada izleyebilirsiniz.</span>
        </span>
      </section>
    );
  }

  return (
    <>
      <button type="button" className="dropzone screen-cta rise" disabled={!connected} onClick={() => void screenShare.share()} data-testid="screen-share">
        <span className="dropzone-icon">
          <Icon name="screen" />
        </span>
        <strong>{connected ? 'Ekranımı paylaş' : 'Bağlantı yok'}</strong>
        <span className="small muted">{connected ? 'Bir sekme, pencere ya da tüm ekranı seçin' : 'Paylaşmak için yeniden bağlanın'}</span>
      </button>
      <section className="glass screen-options rise" aria-label="Paylaşım ayarları">
        <QualityPicker />
        <label className="check setting">
          <span className="grow">
            <span className="block">Sesi de paylaş</span>
            <span className="small muted">Sekme ya da sistem sesi; seçim ekranında ayrıca onaylanır. Tarayıcıya göre değişir.</span>
          </span>
          <input type="checkbox" checked={withAudio} onChange={(e) => screenShare.setWithAudio(e.target.checked)} data-testid="screen-audio" />
          <span className="switch" aria-hidden="true" />
        </label>
      </section>
    </>
  );
}

const QUALITY_OPTIONS: Array<[ScreenQuality, string, string]> = [
  ['detail', 'Net', 'Yazı, kod ve sunumlar keskin kalır.'],
  ['motion', 'Akıcı', 'Video ve animasyonlar 60 fps’e kadar akar.'],
];

/** Can be switched while sharing; it applies live. */
function QualityPicker() {
  const { quality } = useScreenShare();
  const hint = QUALITY_OPTIONS.find(([id]) => id === quality)![2];
  return (
    <div className="stack screen-quality">
      <div className="segmented two" role="group" aria-label="Görüntü kalitesi">
        {QUALITY_OPTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={quality === id ? 'active' : ''}
            aria-pressed={quality === id}
            onClick={() => screenShare.setQuality(id)}
            data-testid={`screen-quality-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="small muted center">{hint}</span>
    </div>
  );
}

function MyShare({ stream }: { stream: MediaStream }) {
  const { localSince } = useScreenShare();
  const { peerName } = useSession();
  const stats = useStreamStats('out', true);
  const [now, setNow] = useState(Date.now);
  const audio = stream.getAudioTracks().length > 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const statsText = describeStats(stats);
  return (
    <section className="glass screen-sharing rise" data-testid="local-screen">
      <div className="screen-self">
        <div className="screen-thumb">
          <StreamVideo stream={stream} muted />
        </div>
        <span className="grow">
          <strong className="block">
            <span className="live-dot" aria-hidden="true" /> Ekranınız paylaşılıyor
          </strong>
          <span className="small muted block">
            {peerName ?? 'Karşı cihaz'} izliyor · <span className="tabular">{formatDuration(now - (localSince ?? now))}</span>
            {audio && ' · sesli'}
          </span>
          {statsText && <span className="small muted block tabular">{statsText}</span>}
        </span>
      </div>
      <QualityPicker />
      <div className="actions">
        <button type="button" className="btn" onClick={() => void screenShare.share()} data-testid="screen-switch">
          <Icon name="resend" /> Değiştir
        </button>
        <button type="button" className="btn danger" onClick={() => screenShare.stop()} data-testid="screen-stop">
          <Icon name="stop" /> Durdur
        </button>
      </div>
    </section>
  );
}
