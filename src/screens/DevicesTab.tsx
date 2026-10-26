import type { CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { rooms, useRooms } from '../hooks/useRooms';
import { deviceLabel, selfDevice } from '../lib/device';
import { formatCode } from '../lib/signaling/code-rendezvous';
import { Radar } from '../components/Radar';
import { DeviceIcon, Icon } from '../components/Icon';
import { ProfileChip } from '../components/Profile';
import { Logo } from '../components/Logo';
import { CodeHostScreen } from './CodeHostScreen';
import { CodeJoinScreen } from './CodeJoinScreen';
import { HostScreen } from './HostScreen';
import { JoinScreen } from './JoinScreen';
import { NearbyConnectScreen } from './NearbyConnectScreen';
import { AirScreen, type AirMode } from './AirScreen';
import type { Tab } from '../components/Dock';
import { useScreenShare } from '../hooks/useScreenShare';
import type { IconName } from '../components/Icon';

export interface UrlInvite {
  /** 6-digit code from …/#k=482913 */
  code: string | null;
  /** QR-mode offer from …/#s=TS1.… */
  offer: string | null;
}

interface Props {
  invite: UrlInvite;
  /** Zero-connection (QR stream) screen, if open. Lives in App, which turns network discovery off for it. */
  air: AirMode | null;
  onAir: (mode: AirMode | null) => void;
  /** Jump to another tab (quick actions once connected). */
  onOpen: (tab: Tab) => void;
}

/** "Devices" tab: discovery and pairing flows, or the current connection. */
export function DevicesTab({ invite, air, onAir, onOpen }: Props) {
  const state = useSession();
  if (state.wasConnected) {
    return (
      <div className="connected-grid">
        <ConnectedView />
        <QuickActions onOpen={onOpen} />
      </div>
    );
  }
  if (air && !state.role) return <AirScreen mode={air} onBack={() => onAir(null)} />;
  if (state.method === 'nearby' && state.role) return <NearbyConnectScreen />;
  if (state.role === 'host') return state.method === 'code' ? <CodeHostScreen /> : <HostScreen />;
  if (state.role === 'join') {
    return state.method === 'code' ? <CodeJoinScreen initialCode={invite.code ?? state.pairCode} /> : <JoinScreen initialOffer={invite.offer} />;
  }
  return <HomeView onAir={onAir} />;
}

function HomeView({ onAir }: { onAir: (mode: AirMode) => void }) {
  return (
    <>
      <header className="brand rise">
        <Logo />
        <div className="grow">
          {/* Desktop: the sidebar already shows the brand, so the page names what to do here. */}
          <h1>
            <span className="brand-mobile">theShare</span>
            <span className="brand-desktop">Cihaz bağlayın</span>
          </h1>
          <p className="small muted">Sunucusuz, cihazdan cihaza paylaşım</p>
        </div>
        <ProfileChip />
      </header>

      <div className="home-grid">
        <div className="home-col rise" style={{ '--i': 1 } as CSSProperties}>
          <Radar />
        </div>

        <div className="home-col">
          <RecentRooms />

          <div className="options">
            <section className="glass option rise" style={{ '--i': 2 } as CSSProperties}>
              <span className="option-icon">
                <Icon name="globe" />
              </span>
              <h2>Uzaktaki cihaz</h2>
              <p className="small muted">Farklı ağdaki biriyle 6 haneli kodla.</p>
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => session.startCodeHost()} data-testid="start-host">
                  Kod oluştur
                </button>
                <button type="button" className="btn" onClick={() => session.reset({ role: 'join', method: 'code' })} data-testid="start-join">
                  Kod gir
                </button>
              </div>
            </section>

            <section className="glass option rise" style={{ '--i': 3 } as CSSProperties}>
              <span className="option-icon">
                <Icon name="qr" />
              </span>
              <h2>İnternetsiz</h2>
              <p className="small muted">Aynı Wi-Fi'da, internet olmadan QR ile.</p>
              <div className="actions">
                <button type="button" className="btn" onClick={() => void session.startHost()} data-testid="qr-host">
                  QR göster
                </button>
                <button type="button" className="btn" onClick={() => session.reset({ role: 'join', method: 'qr' })} data-testid="qr-join">
                  QR tara
                </button>
              </div>
            </section>

            <section className="glass option wide rise" style={{ '--i': 4 } as CSSProperties}>
              <span className="option-icon">
                <Icon name="frames" />
              </span>
              <h2>Sıfır bağlantı</h2>
              <p className="small muted">Hiçbir ağ yok: veri ekrandan kameraya akan QR'larla gider. Küçük dosya ve metin için.</p>
              <div className="actions">
                <button type="button" className="btn" onClick={() => onAir('send')} data-testid="air-send">
                  Gönder
                </button>
                <button type="button" className="btn" onClick={() => onAir('receive')} data-testid="air-receive">
                  Al
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

/** Shortcuts to what you can do now that you're connected. */
function QuickActions({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const { supported } = useScreenShare();
  const actions: Array<[Tab, IconName, string, string]> = [
    ['files', 'files', 'Dosya gönder', 'Sürükleyip bırakın, istersen tek ZIP olarak.'],
    ['clipboard', 'clipboard', 'Metin ve pano', 'Not, bağlantı ya da panodaki her şey.'],
    ['screen', 'screen', supported ? 'Ekran paylaş' : 'Ekranı izle', supported ? 'Çizim, lazer işaretçi ve sohbetle.' : 'Bilgisayardan paylaşılan ekranı izleyin.'],
    ['history', 'history', 'Geçmiş', 'Gönderdikleriniz ve aldıklarınız.'],
  ];
  return (
    <section className="quick-actions" aria-label="Hızlı işlemler">
      {actions.map(([tab, icon, title, text], i) => (
        <button key={tab} type="button" className={`glass quick-action qa-${tab} rise`} style={{ '--i': i + 1 } as CSSProperties} onClick={() => onOpen(tab)}>
          <span className="option-icon">
            <Icon name={icon} />
          </span>
          <span className="grow">
            <strong className="block">{title}</strong>
            <span className="small muted">{text}</span>
          </span>
          <Icon name="chevron" className="qa-chevron" />
        </button>
      ))}
    </section>
  );
}

function minutesAgo(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  return `${Math.floor(minutes / 60)} sa önce`;
}

/** Code rooms from the last 24 hours: reopen yours so a link you shared works again, or rejoin theirs. */
function RecentRooms() {
  const list = useRooms();
  if (!list.length) return null;
  return (
    <section className="glass pending rise" aria-label="Son odalar" data-testid="recent-rooms">
      <h2 className="eyebrow">Son odalar</h2>
      <ul className="files">
        {list.map((r) => (
          <li key={r.code}>
            <span className="grow">
              <strong className="room-code">{formatCode(r.code)}</strong>
              <span className="small muted block">
                {r.role === 'host' ? 'Oluşturduğun oda' : 'Katıldığın oda'} · {minutesAgo(r.at)}
              </span>
            </span>
            <button type="button" className="btn small primary" onClick={() => session.rejoinRoom(r.code, r.role)} data-testid="rejoin-room">
              {r.role === 'host' ? 'Odayı aç' : 'Tekrar gir'}
            </button>
            <button type="button" className="link" onClick={() => rooms.forget(r.code)} aria-label={`${formatCode(r.code)} odasını listeden kaldır`}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConnectedView() {
  const { linkState, peerName, peer, pairingCode, error, transfers, method, role, pairCode } = useSession();
  const self = selfDevice();
  const connected = linkState === 'connected';
  const room = method === 'code' && role && pairCode ? { code: pairCode, role } : null;

  const confirmUnsaved = () => {
    const unsaved = transfers.some((t) => t.received.some((r) => r.file && !r.downloaded));
    return !unsaved || confirm('Kaydedilmemiş dosyalar silinecek. Devam edilsin mi?');
  };
  const leave = () => {
    if (confirmUnsaved()) session.leave();
  };
  const rejoin = () => {
    if (room && confirmUnsaved()) session.rejoinRoom(room.code, room.role);
  };

  return (
    <section className={`glass link-hero rise${connected ? '' : ' off'}`}>
      <p className="eyebrow">{connected ? 'Bağlı' : 'Bağlantı koptu'}</p>
      <div className="link-pair">
        <div className="link-end">
          <span className="avatar big">
            <DeviceIcon kind={self.kind} />
          </span>
          <strong>{self.name}</strong>
          <span className="small muted">{deviceLabel(self)} · bu cihaz</span>
        </div>
        <span className={`beam${connected ? '' : ' broken'}`} aria-hidden="true">
          <span />
        </span>
        <div className="link-end">
          <span className="avatar big">
            <DeviceIcon kind={peer?.kind ?? 'computer'} />
          </span>
          <strong>{peerName ?? 'Bağlı cihaz'}</strong>
          <span className="small muted">{peer ? deviceLabel(peer) : '—'}</span>
        </div>
      </div>

      {connected && pairingCode && (
        <div className="security">
          <span className="small muted">
            <Icon name="shield" /> Güvenlik kodu
          </span>
          <strong className="code-digits">{pairingCode}</strong>
          <span className="small muted">İki ekranda aynı olmalı. Farklıysa bağlantıyı hemen kesin.</span>
        </div>
      )}
      {!connected && error && <p className="notice error">{error}</p>}

      {room && (
        <p className="small muted">
          Oda <strong className="text">{formatCode(room.code)}</strong>
          {connected ? ' · bağlantı koparsa aynı kodla geri dönebilirsiniz' : ''}
        </p>
      )}
      {!connected && room && (
        <>
          <button type="button" className="btn primary" onClick={rejoin} data-testid="rejoin">
            {room.role === 'host' ? 'Odayı yeniden aç' : 'Odaya tekrar gir'}
          </button>
          <p className="small muted">
            {room.role === 'host' ? 'Karşı taraf aynı bağlantıyı ya da kodu tekrar kullanabilir.' : 'Odayı oluşturan cihazın da odayı yeniden açması gerekir.'}
          </p>
        </>
      )}
      <button type="button" className="btn danger" onClick={leave} data-testid="leave">
        {connected ? 'Bağlantıyı kes' : 'Ana ekrana dön'}
      </button>
    </section>
  );
}
