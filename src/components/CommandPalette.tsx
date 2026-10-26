import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { session, useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { palette, usePaletteOpen } from '../hooks/usePalette';
import { profile, useProfile } from '../hooks/useProfile';
import { pickAndSend, sendClipboardNow } from '../hooks/quickSend';
import { confirmLeave } from '../screens/Hub';
import type { Tab } from './Dock';
import { Icon, type IconName } from './Icon';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: IconName;
  hint?: string;
  /** Extra words to match (Turkish and the obvious English ones). */
  words?: string;
  run: () => void;
}

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

const TABS: Array<[Tab, string, IconName]> = [
  ['devices', 'Cihazlar', 'radar'],
  ['files', 'Dosyalar', 'files'],
  ['clipboard', 'Pano', 'clipboard'],
  ['screen', 'Ekran', 'screen'],
  ['history', 'Geçmiş', 'history'],
];

/**
 * Ctrl+K (Cmd+K): every action in one searchable list, which changes with the
 * state (connected or not, sharing or not). Arrow keys pick, Enter runs.
 */
export function CommandPalette({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const open = usePaletteOpen();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return open ? <Palette onOpen={onOpen} /> : null;
}

function Palette({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const { linkState, role, peer } = useSession();
  const { supported, local, remote } = useScreenShare();
  const { settings } = useProfile();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const connected = linkState === 'connected';

  const commands = useMemo(() => {
    const list: Command[] = [];
    const go = (tab: Tab, then?: () => void) => () => {
      onOpen(tab);
      then?.();
    };
    if (connected) {
      list.push({ id: 'files', group: 'Gönder', label: 'Dosya gönder', icon: 'upload', words: 'file send', run: () => void pickAndSend() });
      list.push({ id: 'clip', group: 'Gönder', label: 'Panodakini gönder', icon: 'clipboard', hint: 'Ctrl V', words: 'paste metin text', run: () => void sendClipboardNow() });
      if (local) list.push({ id: 'stop', group: 'Ekran', label: 'Ekran paylaşımını durdur', icon: 'stop', words: 'screen', run: () => screenShare.stop() });
      else if (supported) list.push({ id: 'share', group: 'Ekran', label: 'Ekranımı paylaş', icon: 'screen', words: 'screen share sunum', run: go('screen', () => void screenShare.share()) });
      if (!remote && (!peer || peer.kind === 'computer')) {
        list.push({ id: 'ask', group: 'Ekran', label: 'Ekranını paylaşmasını iste', icon: 'eye', words: 'screen request', run: go('screen', () => screenShare.ask()) });
      }
      list.push({
        id: 'leave',
        group: 'Bağlantı',
        label: 'Bağlantıyı kes',
        icon: 'close',
        words: 'disconnect çık',
        run: () => {
          if (confirmLeave()) session.leave();
        },
      });
    } else if (!role) {
      list.push({ id: 'code-host', group: 'Bağlan', label: 'Kod oluştur (uzaktaki cihaz)', icon: 'globe', words: 'code connect', run: go('devices', () => session.startCodeHost()) });
      list.push({ id: 'code-join', group: 'Bağlan', label: 'Kod gir', icon: 'globe', words: 'code join', run: go('devices', () => session.reset({ role: 'join', method: 'code' })) });
      list.push({ id: 'qr-host', group: 'Bağlan', label: 'QR göster (internetsiz)', icon: 'qr', words: 'offline', run: go('devices', () => void session.startHost()) });
      list.push({ id: 'qr-join', group: 'Bağlan', label: 'QR tara (internetsiz)', icon: 'qr', words: 'offline scan', run: go('devices', () => session.reset({ role: 'join', method: 'qr' })) });
    }
    for (const [tab, label, icon] of TABS) list.push({ id: `tab-${tab}`, group: 'Git', label, icon, words: 'sekme git tab', run: go(tab) });
    const schemes: Array<['light' | 'dark' | 'system', string]> = [
      ['light', 'Açık moda geç'],
      ['dark', 'Koyu moda geç'],
      ['system', 'Cihazın temasını izle'],
    ];
    for (const [scheme, label] of schemes) {
      if (settings.scheme !== scheme) list.push({ id: `scheme-${scheme}`, group: 'Görünüm', label, icon: 'eye', words: 'tema theme dark light', run: () => void profile.updateSettings({ scheme }) });
    }
    return list;
  }, [connected, role, peer, supported, local, remote, settings.scheme, onOpen]);

  const q = fold(query.trim());
  const shown = q ? commands.filter((c) => fold(`${c.label} ${c.group} ${c.words ?? ''}`).includes(q)) : commands;
  const current = Math.min(index, Math.max(0, shown.length - 1));

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    palette.close();
    c.run();
  };

  return createPortal(
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && palette.close()}>
      <div className="glass palette" role="dialog" aria-modal="true" aria-label="Komut paleti" data-testid="palette">
        <div className="palette-search">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((current + 1) % Math.max(1, shown.length));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((current - 1 + shown.length) % Math.max(1, shown.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(shown[current]);
              } else if (e.key === 'Escape') {
                palette.close();
              }
            }}
            placeholder="Ne yapmak istersiniz?"
            aria-label="Komut ara"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[current] ? `cmd-${shown[current]!.id}` : undefined}
            data-testid="palette-input"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {shown.length === 0 && <p className="small muted center palette-empty">“{query}” için komut yok.</p>}
          {shown.map((c, i) => (
            <button
              key={c.id}
              id={`cmd-${c.id}`}
              type="button"
              role="option"
              aria-selected={i === current}
              className={`palette-item${i === current ? ' active' : ''}`}
              data-index={i}
              onMouseMove={() => i !== current && setIndex(i)}
              onClick={() => run(c)}
              data-testid={`cmd-${c.id}`}
            >
              <span className={`palette-icon g-${c.group === 'Git' ? 'nav' : c.icon}`}>
                <Icon name={c.icon} />
              </span>
              <span className="grow">{c.label}</span>
              <span className="small muted">{c.hint ?? c.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
