import type { CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { deviceLabel, selfDevice } from '../lib/device';
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
}

/** "Devices" tab: discovery and pairing flows, or the current connection. */
export function DevicesTab({ invite, air, onAir }: Props) {
  const state = useSession();
  if (state.wasConnected) return <ConnectedView />;
  if (air && !state.role) return <AirScreen mode={air} onBack={() => onAir(null)} />;
  if (state.method === 'nearby' && state.role) return <NearbyConnectScreen />;
  if (state.role === 'host') return state.method === 'code' ? <CodeHostScreen /> : <HostScreen />;
  if (state.role === 'join') {
    return state.method === 'code' ? <CodeJoinScreen initialCode={invite.code} /> : <JoinScreen initialOffer={invite.offer} />;
  }
  return <HomeView onAir={onAir} />;
}

function HomeView({ onAir }: { onAir: (mode: AirMode) => void }) {
  return (
    <>
      <header className="brand rise">
        <Logo />
        <div className="grow">
          <h1>theShare</h1>
          <p className="small muted">Sunucusuz, cihazdan cihaza paylaşım</p>
        </div>
        <ProfileChip />
      </header>

      <div className="rise" style={{ '--i': 1 } as CSSProperties}>
        <Radar />
      </div>

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
    </>
  );
}

function ConnectedView() {
  const { linkState, peerName, peer, pairingCode, error, transfers } = useSession();
  const self = selfDevice();
  const connected = linkState === 'connected';

  const leave = () => {
    const unsaved = transfers.some((t) => t.received.some((r) => r.file && !r.downloaded));
    if (unsaved && !confirm('Kaydedilmemiş dosyalar silinecek. Çıkılsın mı?')) return;
    session.leave();
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

      <button type="button" className="btn danger" onClick={leave} data-testid="leave">
        {connected ? 'Bağlantıyı kes' : 'Ana ekrana dön'}
      </button>
    </section>
  );
}
