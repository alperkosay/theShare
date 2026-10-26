import { useState, type CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { rooms, useRooms } from '../hooks/useRooms';
import { useNearby } from '../hooks/useNearby';
import { formatCode } from '../lib/signaling/code-rendezvous';
import { Radar } from '../components/Radar';
import { Icon } from '../components/Icon';
import { ProfileChip } from '../components/Profile';
import { Logo } from '../components/Logo';
import { CodeHostScreen } from './CodeHostScreen';
import { CodeJoinScreen } from './CodeJoinScreen';
import { HostScreen } from './HostScreen';
import { JoinScreen } from './JoinScreen';
import { NearbyConnectScreen } from './NearbyConnectScreen';
import { AirScreen, type AirMode } from './AirScreen';
import type { Tab } from '../components/Dock';
import { Hub } from './Hub';

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
  if (state.wasConnected) return <Hub onOpen={onOpen} />;
  if (air && !state.role) return <AirScreen mode={air} onBack={() => onAir(null)} />;
  if (state.method === 'nearby' && state.role) return <NearbyConnectScreen />;
  if (state.role === 'host') return state.method === 'code' ? <CodeHostScreen /> : <HostScreen />;
  if (state.role === 'join') {
    return state.method === 'code' ? <CodeJoinScreen initialCode={invite.code ?? state.pairCode} /> : <JoinScreen initialOffer={invite.offer} />;
  }
  return <HomeView onAir={onAir} />;
}

function HomeView({ onAir }: { onAir: (mode: AirMode) => void }) {
  // Same Wi-Fi usually shows up on the radar, so the QR card only takes room
  // when asked for, or when the radar can't work (it needs internet).
  const { status } = useNearby();
  const [qrAsked, setQrAsked] = useState(false);
  const showQr = qrAsked || status === 'unavailable';

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

          <div className={`options${showQr ? '' : ' two'}`}>
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

            {showQr && (
              <section className="glass option rise" style={{ '--i': 3 } as CSSProperties} data-testid="qr-option">
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
            )}

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

          {!showQr && (
            <button type="button" className="link small" onClick={() => setQrAsked(true)} data-testid="qr-reveal">
              <Icon name="qr" />
              İnternet yok mu? Aynı Wi-Fi'da QR ile bağlan
            </button>
          )}
        </div>
      </div>
    </>
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
