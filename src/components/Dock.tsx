import type { CSSProperties } from 'react';
import { useSession } from '../hooks/useSession';
import { useScreenShare } from '../hooks/useScreenShare';
import { deviceLabel } from '../lib/device';
import { DeviceIcon, Icon, type IconName } from './Icon';
import { Logo } from './Logo';

export type Tab = 'devices' | 'files' | 'clipboard' | 'screen' | 'history';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'devices', label: 'Cihazlar', icon: 'radar' },
  { id: 'files', label: 'Dosyalar', icon: 'files' },
  { id: 'clipboard', label: 'Pano', icon: 'clipboard' },
  { id: 'screen', label: 'Ekran', icon: 'screen' },
  { id: 'history', label: 'Geçmiş', icon: 'history' },
];

interface Props {
  tab: Tab;
  onChange: (tab: Tab) => void;
  /** A count, or 'live' for a dot (something is streaming there right now). */
  badges: Partial<Record<Tab, number | 'live'>>;
}

/**
 * Phones: a floating glass tab bar; the glowing pill slides under the active tab.
 * Desktop (CSS, ≥ 1024px): the same nav becomes a sidebar with the brand on
 * top and the connection at the bottom.
 */
export function Dock({ tab, onChange, badges }: Props) {
  const index = TABS.findIndex((t) => t.id === tab);
  return (
    <nav className="dock" aria-label="Bölümler" style={{ '--items': TABS.length, '--index': index } as CSSProperties}>
      <div className="dock-brand" aria-hidden="true">
        <Logo size={36} />
        <span>
          <strong className="block">theShare</strong>
          <span className="small muted">Cihazdan cihaza</span>
        </span>
      </div>
      <div className="dock-items">
        <span className="dock-pill" aria-hidden="true" />
        {TABS.map((t) => {
          const active = t.id === tab;
          const badge = badges[t.id] ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              className={`dock-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(t.id)}
              data-testid={`tab-${t.id}`}
            >
              <span className="dock-icon">
                <Icon name={t.icon} />
                {badge === 'live' ? (
                  <span className="badge live" aria-label="canlı" />
                ) : (
                  badge > 0 && (
                    <span className="badge" aria-label={`${badge} yeni`}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )
                )}
              </span>
              <span className="dock-label">{t.label}</span>
            </button>
          );
        })}
      </div>
      <DockStatus onOpen={() => onChange('devices')} />
    </nav>
  );
}

/** Desktop sidebar footer: who we're connected to, at a glance. */
function DockStatus({ onOpen }: { onOpen: () => void }) {
  const { linkState, wasConnected, peerName, peer } = useSession();
  const { local, remote } = useScreenShare();
  const connected = linkState === 'connected';
  let detail: string;
  if (!wasConnected) detail = 'Bağlı değil';
  else if (!connected) detail = 'Bağlantı koptu';
  else if (local && remote) detail = 'İki ekran paylaşılıyor';
  else if (local) detail = 'Ekranınızı sunuyorsunuz';
  else if (remote) detail = 'Ekranını paylaşıyor';
  else detail = peer ? `${deviceLabel(peer)} · bağlı` : 'Bağlı';

  return (
    <button type="button" className="dock-status" onClick={onOpen}>
      <span className="avatar">
        {wasConnected ? <DeviceIcon kind={peer?.kind ?? 'computer'} /> : <Icon name="radar" />}
        <span className={`dot ${connected ? 'on' : 'off'}`} aria-hidden="true" />
      </span>
      <span className="grow">
        <strong className="block ellipsis">{wasConnected ? (peerName ?? 'Bağlı cihaz') : 'Cihaz bağlayın'}</strong>
        <span className="small muted block ellipsis">
          {(local || remote) && connected && <span className="live-dot" aria-hidden="true" />} {detail}
        </span>
      </span>
    </button>
  );
}
