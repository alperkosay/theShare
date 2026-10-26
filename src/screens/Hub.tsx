import type { CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { pickAndSend, sendClipboardNow } from '../hooks/quickSend';
import { deviceLabel, selfDevice } from '../lib/device';
import { formatSpeed } from '../lib/format';
import { formatCode } from '../lib/signaling/code-rendezvous';
import { ActivityFeed } from '../components/Activity';
import { DeviceIcon, Icon, type IconName } from '../components/Icon';
import { VerifyBadge } from '../components/Verify';
import type { Tab } from '../components/Dock';

/** Unsaved received files are lost when the session ends; ask first. */
export function confirmLeave(): boolean {
  const unsaved = session.getSnapshot().transfers.some((t) => t.received.some((r) => r.file && !r.downloaded));
  return !unsaved || confirm('Kaydedilmemiş dosyalar silinecek. Devam edilsin mi?');
}

interface Action {
  title: string;
  hint: string;
  icon: IconName;
  run: () => void;
  /** Only where nothing else on the page does it (phones have no drop zone). */
  phoneOnly?: boolean;
}

/**
 * The connected "hub" (Devices tab): both devices joined by a live beam that
 * shows what's moving, a drop target, one-step actions and, beside them, the
 * feed of everything this connection sent and received. Also where a dropped
 * connection can be rejoined or left.
 */
export function Hub({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const { linkState, peerName, peer, error, transfers, method, role, pairCode } = useSession();
  const { supported, local, remote } = useScreenShare();
  const self = selfDevice();
  const connected = linkState === 'connected';
  const name = peerName ?? 'Bağlı cihaz';
  const room = method === 'code' && role && pairCode ? { code: pairCode, role } : null;
  const moving = transfers.find((t) => t.status === 'active');
  const movingName = moving ? (moving.files.length === 1 ? moving.files[0]!.name : `${moving.files.length} dosya`) : null;
  // Phone and tablet browsers can't capture their screen.
  const peerCanShare = !peer || peer.kind === 'computer';

  const leave = () => {
    if (confirmLeave()) session.leave();
  };
  const rejoin = () => {
    if (room && confirmLeave()) session.rejoinRoom(room.code, room.role);
  };

  // Actions, not navigation: the rail already leads to every tab.
  const actions: Action[] = [{ title: 'Dosya seç', hint: 'Bir ya da birden çok dosya', icon: 'files', run: () => void pickAndSend(), phoneOnly: true }];
  actions.push({ title: 'Panodakini gönder', hint: 'Kopyaladığınız metin, tek dokunuşla', icon: 'clipboard', run: () => void sendClipboardNow() });
  if (local || remote) {
    actions.push({ title: 'Paylaşıma dön', hint: local && remote ? 'İki ekran paylaşılıyor' : local ? 'Ekranınızı sunuyorsunuz' : `${name} ekranını paylaşıyor`, icon: 'screen', run: () => onOpen('screen') });
  } else if (supported) {
    actions.push({
      title: 'Ekranımı paylaş',
      hint: 'Çizim, lazer ve sohbetle',
      icon: 'screen',
      run: () => {
        onOpen('screen');
        void screenShare.share();
      },
    });
  }
  if (!remote && peerCanShare) {
    actions.push({
      title: 'Ekranını iste',
      hint: `${name} onaylarsa açılır`,
      icon: 'eye',
      run: () => {
        screenShare.ask();
        onOpen('screen');
      },
    });
  }

  return (
    <div className="hub">
      <header className="hub-head rise">
        <span className="grow">
          <span className={`hub-state small${connected ? ' on' : ' off'}`}>
            <span className={`dot ${connected ? 'on' : 'off'}`} aria-hidden="true" />
            {connected ? 'Bağlı · doğrudan ve şifreli' : 'Bağlantı koptu'}
          </span>
          <h1 className="hub-title">{connected ? `${name} ile bağlısınız` : `${name} ile bağlantı koptu`}</h1>
        </span>
        <button type="button" className="btn small danger" onClick={leave} data-testid="leave">
          {connected ? 'Bağlantıyı kes' : 'Ana ekrana dön'}
        </button>
      </header>

      <div className="hub-grid">
        <div className="hub-main">
          <section className={`glass hub-link rise${connected ? '' : ' off'}`} style={{ '--i': 1 } as CSSProperties} aria-label="Bağlantı">
            <div className="hub-end">
              <span className={`hub-orb${connected ? ' live' : ''}`}>
                <DeviceIcon kind={self.kind} />
              </span>
              <strong>{self.name}</strong>
              <span className="small muted">{deviceLabel(self)} · bu cihaz</span>
            </div>
            <div className="hub-beam">
              <span className={`hub-chip small${moving ? ' busy' : ''}`}>
                {moving ? (
                  <>
                    {moving.direction === 'in' ? '↓' : '↑'} {formatSpeed(moving.speed)} · <span className="ellipsis">{movingName}</span>
                  </>
                ) : connected ? (
                  'Hazır'
                ) : (
                  'Bağlantı yok'
                )}
              </span>
              <span className={`hub-track${connected ? '' : ' broken'}${moving ? ' busy' : ''}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {connected ? (
                <VerifyBadge className="small muted hub-code" label />
              ) : (
                <span className="small muted">Sunucu yok, aradaki kimse görmez</span>
              )}
              {room && connected && (
                <span className="small muted">
                  Oda <strong className="text">{formatCode(room.code)}</strong> · koparsa aynı kodla dönülür
                </span>
              )}
            </div>
            <div className="hub-end">
              <span className={`hub-orb${connected ? ' live' : ''}`} style={{ '--delay': '1.2s' } as CSSProperties}>
                <DeviceIcon kind={peer?.kind ?? 'computer'} />
              </span>
              <strong>{name}</strong>
              <span className="small muted">{peer ? deviceLabel(peer) : '—'}</span>
            </div>
          </section>

          {!connected && (
            <section className="glass hub-lost rise" role="alert">
              {error && <p className="notice error">{error}</p>}
              {room && (
                <>
                  <p className="small muted">
                    Oda <strong className="text">{formatCode(room.code)}</strong>
                  </p>
                  <button type="button" className="btn primary" onClick={rejoin} data-testid="rejoin">
                    {room.role === 'host' ? 'Odayı yeniden aç' : 'Odaya tekrar gir'}
                  </button>
                  <p className="small muted">
                    {room.role === 'host' ? 'Karşı taraf aynı bağlantıyı ya da kodu tekrar kullanabilir.' : 'Odayı oluşturan cihazın da odayı yeniden açması gerekir.'}
                  </p>
                </>
              )}
            </section>
          )}

          {connected && (
            <button type="button" className="hub-drop rise" style={{ '--i': 2 } as CSSProperties} onClick={() => void pickAndSend()}>
              <span className="hub-drop-icon">
                <Icon name="upload" />
              </span>
              <strong>Dosyaları buraya bırakın</strong>
              <span className="muted">
                ya da tıklayıp seçin · <kbd>Ctrl V</kbd> ile panodakini gönderin
              </span>
            </button>
          )}

          {connected && (
            <div className="hub-tiles">
              {actions.map((a, i) => (
                <button
                  key={a.title}
                  type="button"
                  className={`glass hub-tile tile-${a.icon} rise${a.phoneOnly ? ' phone-only' : ''}`}
                  style={{ '--i': i + 3 } as CSSProperties}
                  onClick={a.run}
                >
                  <span className="option-icon">
                    <Icon name={a.icon} />
                  </span>
                  <strong>{a.title}</strong>
                  <span className="small muted">{a.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <ActivityFeed onOpen={onOpen} />
      </div>
    </div>
  );
}
