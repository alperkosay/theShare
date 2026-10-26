import type { CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';

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

/** Floating glass tab bar; the glowing pill slides under the active tab. */
export function Dock({ tab, onChange, badges }: Props) {
  const index = TABS.findIndex((t) => t.id === tab);
  return (
    <nav className="dock" aria-label="Bölümler" style={{ '--items': TABS.length } as CSSProperties}>
      <span className="dock-pill" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden="true" />
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
    </nav>
  );
}
