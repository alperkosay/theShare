import { useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { useProfile } from '../hooks/useProfile';
import { deviceLabel } from '../lib/device';
import type { ScreenQuality } from '../lib/webrtc/media';
import { NotConnected, PeerBar } from '../components/PeerBar';
import { DeviceIcon, Icon, type IconName } from '../components/Icon';
import { Meeting } from './Meeting';

/**
 * "Screen" tab: while either side shares, the meeting view (stage, drawings,
 * chat); otherwise the lobby to start sharing or ask for the other screen.
 */
export function ScreenTab({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { linkState, wasConnected } = useSession();
  const { remote, local, error } = useScreenShare();
  const connected = linkState === 'connected';

  if (!wasConnected) {
    return <NotConnected text="Ekranınızı paylaşmak ya da karşı cihazın ekranını izlemek için önce bir cihaza bağlanın." onConnect={onOpenDevices} />;
  }

  const errorNotice = error && (
    <p className="notice error" role="alert" onClick={() => screenShare.dismissError()}>
      {error}
    </p>
  );

  if (local || remote) {
    return (
      <>
        {errorNotice}
        <Meeting />
      </>
    );
  }

  return (
    <>
      <PeerBar onOpen={onOpenDevices} />
      {errorNotice}
      <div className="screen-lobby">
        <div className="lobby-col">
          <ShareStart connected={connected} />
        </div>
        <div className="lobby-col">
          <PeerIdle connected={connected} />
          <Features />
        </div>
      </div>
      <p className="small muted center screen-privacy">
        <Icon name="shield" /> Görüntü cihazlar arasında doğrudan ve şifreli gider; hiçbir sunucudan geçmez.
      </p>
    </>
  );
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

const FEATURES: Array<[IconName, string, string]> = [
  ['draw', 'Ekrana çizin', 'Kalem, fosforlu, ok ve şekiller iki tarafta da anında görünür.'],
  ['laser', 'Lazerle gösterin', '“Şuraya bakın” demek için iz bırakan bir işaretçi.'],
  ['chat', 'Yanında sohbet', 'Paylaşım sırasında yazışın; mesajlar Pano’da da kalır.'],
  ['camera', 'Ekran görüntüsü', 'Çizimleriyle birlikte kaydedin ya da karşıya gönderin.'],
];

function Features() {
  return (
    <section className="glass screen-features rise" aria-label="Ekran paylaşımında neler var">
      <h2 className="eyebrow">Paylaşırken</h2>
      <ul>
        {FEATURES.map(([icon, title, text]) => (
          <li key={title}>
            <span className="feature-icon">
              <Icon name={icon} />
            </span>
            <span>
              <strong className="block">{title}</strong>
              <span className="small muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShareStart({ connected }: { connected: boolean }) {
  const { supported } = useScreenShare();
  const withAudio = useProfile().settings.screenAudio;

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

/** Remembered in the profile; can also be switched from the meeting's control bar. */
function QualityPicker() {
  const quality = useProfile().settings.screenQuality;
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
