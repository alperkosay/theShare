import { useState, type FormEvent } from 'react';
import { session, useSession } from '../hooks/useSession';
import { useScreenShare } from '../hooks/useScreenShare';
import { sendTextNow } from '../hooks/quickSend';
import { formatBytes, formatSpeed } from '../lib/format';
import type { TransferStatus, TransferView } from '../lib/transfer/manager';
import type { Tab } from './Dock';
import { Icon, type IconName } from './Icon';

type Filter = 'all' | 'files' | 'text';

const FILTERS: Array<[Filter, string]> = [
  ['all', 'Tümü'],
  ['files', 'Dosya'],
  ['text', 'Metin'],
];

const STATUS: Record<TransferStatus, string> = {
  pending: 'Onay bekliyor',
  active: 'Aktarılıyor',
  finishing: 'Kaydediliyor',
  done: 'Tamam',
  rejected: 'Reddedildi',
  cancelled: 'İptal',
  failed: 'Başarısız',
};

interface Item {
  id: string;
  at: number;
  kind: 'files' | 'text';
  direction: 'in' | 'out';
  title: string;
  meta: string;
  transfer?: TransferView;
}

const clock = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const filesTitle = (files: Array<{ name: string }>) => (files.length === 1 ? files[0]!.name : `${files.length} dosya`);

/**
 * The hub's live feed: everything this connection sent and received, newest
 * first, with accept/decline for incoming files right there and a quick
 * message box. Same data as the Files and Clipboard tabs, in one stream.
 */
export function ActivityFeed({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const { transfers, messages, linkState, peerName } = useSession();
  const { local, remote } = useScreenShare();
  const [filter, setFilter] = useState<Filter>('all');
  const [text, setText] = useState('');
  const connected = linkState === 'connected';
  const name = peerName ?? 'Karşı cihaz';

  const items = [
    ...transfers.map((t): Item => {
      const bytes = t.status === 'active' ? `${formatBytes(t.transferredBytes)} / ${formatBytes(t.totalBytes)} · ${formatSpeed(t.speed)}` : formatBytes(t.totalBytes);
      return { id: t.id, at: t.createdAt, kind: 'files', direction: t.direction, title: filesTitle(t.files), meta: `${STATUS[t.status]} · ${bytes}`, transfer: t };
    }),
    ...messages.map((m): Item => ({ id: m.id, at: m.at, kind: 'text', direction: m.direction, title: m.text, meta: `${m.direction === 'in' ? name : 'Siz'} · ${clock(m.at)}` })),
  ]
    .filter((i) => filter === 'all' || i.kind === filter)
    .sort((a, b) => b.at - a.at);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (sendTextNow(text)) setText('');
  };

  return (
    <aside className="glass activity" aria-label="Akış" data-testid="activity">
      <header className="activity-head">
        <strong className="grow">Akış</strong>
        <div className="segmented" role="group" aria-label="Filtre">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="activity-list">
        {(local || remote) && connected && (
          <button type="button" className="activity-item live" onClick={() => onOpen('screen')}>
            <span className="activity-icon screen">
              <Icon name="screen" />
            </span>
            <span className="grow">
              <strong className="block ellipsis">{local && remote ? 'İki ekran paylaşılıyor' : local ? 'Ekranınızı sunuyorsunuz' : `${name} ekranını paylaşıyor`}</strong>
              <span className="small muted">
                <span className="live-dot" aria-hidden="true" /> Canlı · açmak için tıklayın
              </span>
            </span>
          </button>
        )}
        {items.length === 0 && (
          <p className="small muted center activity-empty">Gönderdikleriniz ve gelenler burada akar. Dosya bırakın, Ctrl+V'ye basın ya da aşağıya yazın.</p>
        )}
        {items.map((item) => (
          <ActivityRow key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>

      {connected && (
        <form className="activity-compose" onSubmit={onSubmit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${name} cihazına yazın…`} aria-label="Mesaj" data-testid="feed-input" />
          <button type="submit" className="btn small primary" disabled={!text.trim()} aria-label="Gönder">
            <Icon name="send" />
          </button>
        </form>
      )}
    </aside>
  );
}

function ActivityRow({ item, onOpen }: { item: Item; onOpen: (tab: Tab) => void }) {
  const t = item.transfer;
  const icon: IconName = item.kind === 'text' ? 'chat' : item.direction === 'in' ? 'arrowDown' : 'arrowUp';
  const pendingIn = t?.direction === 'in' && t.status === 'pending';
  const progress = t && (t.status === 'active' || t.status === 'finishing') && t.totalBytes > 0 ? t.transferredBytes / t.totalBytes : null;
  return (
    <div className={`activity-item${pendingIn ? ' pending' : ''}`}>
      <button type="button" className="activity-main" onClick={() => onOpen(item.kind === 'text' ? 'clipboard' : 'files')}>
        <span className={`activity-icon ${item.kind === 'text' ? 'text' : item.direction}`}>
          <Icon name={icon} />
        </span>
        <span className="grow">
          <strong className="block ellipsis">{item.title}</strong>
          <span className="small muted block ellipsis">{item.meta}</span>
          {progress !== null && (
            <span className="progress activity-progress" aria-hidden="true">
              <span className="progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          )}
        </span>
      </button>
      {pendingIn && t && (
        <div className="activity-actions">
          <button type="button" className="btn small primary" onClick={() => void session.manager?.accept(t.id)}>
            Kabul et
          </button>
          <button type="button" className="btn small" onClick={() => session.manager?.reject(t.id)}>
            Reddet
          </button>
        </div>
      )}
    </div>
  );
}
