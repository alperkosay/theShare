import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { history, useHistory } from '../hooks/useHistory';
import { useProfile } from '../hooks/useProfile';
import { useSession } from '../hooks/useSession';
import { deviceLabel } from '../lib/device';
import { formatBytes } from '../lib/format';
import { filterHistory, groupByDay, peerTotals, type DirectionFilter, type HistoryEntry } from '../lib/storage/history';
import { canPickWithHandles, pickFilesWithHandles } from '../lib/storage/resend';
import { CopyButton } from '../components/CopyButton';
import { Icon } from '../components/Icon';
import { ProfileChip } from '../components/Profile';
import { Thumb, Viewer } from '../components/Preview';
import { Sheet } from '../components/Sheet';

const STATUS: Record<HistoryEntry['status'], string> = {
  done: '✓',
  cancelled: 'İptal',
  failed: 'Hata',
  rejected: 'Reddedildi',
};

const METHOD: Record<HistoryEntry['method'], string> = {
  nearby: 'Yakındaki cihazlar',
  code: '6 haneli kod',
  qr: 'QR',
};

const FILTERS: Array<[DirectionFilter, string]> = [
  ['all', 'Tümü'],
  ['out', 'Gönderilen'],
  ['in', 'Alınan'],
];

const time = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

function title(e: HistoryEntry): string {
  if (e.kind === 'text') return e.textPreview ?? 'Metin';
  const files = e.files ?? [];
  return files.length === 1 ? files[0]!.name : `${files.length} dosya`;
}

/** "History" tab: what was sent and received on this device, grouped by day. */
export function HistoryTab({ onOpenFiles }: { onOpenFiles: () => void }) {
  const { entries, loaded } = useHistory();
  const { settings } = useProfile();
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entries.find((e) => e.id === openId) ?? null;
  const groups = groupByDay(filterHistory(entries, direction, query));

  return (
    <>
      <header className="tab-header rise">
        <h1 className="title">Geçmiş</h1>
        <ProfileChip />
      </header>

      {!settings.keepHistory && <p className="notice small">Geçmiş kapalı; yeni aktarımlar kaydedilmiyor. Profilinden açabilirsin.</p>}

      {entries.length > 0 && (
        <div className="stack rise" style={{ '--i': 1 } as CSSProperties}>
          <div className="segmented" role="group" aria-label="Yön">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className={direction === id ? 'active' : ''} aria-pressed={direction === id} onClick={() => setDirection(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="search">
            <Icon name="search" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Dosya adı ya da cihaz ara" data-testid="history-search" />
          </label>
        </div>
      )}

      {loaded && entries.length === 0 ? (
        <div className="glass empty rise">
          <span className="avatar big">
            <Icon name="history" />
          </span>
          <p className="muted">Gönderdiğin ve aldığın dosyalar burada listelenir.</p>
        </div>
      ) : (
        groups.length === 0 && entries.length > 0 && <p className="small muted center">Eşleşen kayıt yok.</p>
      )}

      {groups.map((g, gi) => (
        <section key={g.label} className="stack rise" style={{ '--i': Math.min(gi + 2, 6) } as CSSProperties} aria-label={g.label}>
          <h2 className="eyebrow">{g.label}</h2>
          <div className="glass history-list">
            {g.entries.map((e) => (
              <button key={e.id} type="button" className="history-row" onClick={() => setOpenId(e.id)} data-testid="history-row" data-direction={e.direction}>
                <span className={`arrow ${e.status}`}>
                  <Icon name={e.kind === 'text' ? 'clipboard' : e.direction === 'out' ? 'arrowUp' : 'arrowDown'} />
                </span>
                <span className="grow">
                  <span className="filename block ellipsis">{title(e)}</span>
                  <span className="small muted block ellipsis">
                    {time(e.at)} · {formatBytes(e.totalBytes)} · {e.direction === 'out' ? '→' : '←'} {e.peer.name} · {deviceLabel(e.peer)}
                  </span>
                </span>
                <span className={`small history-status ${e.status}`}>{STATUS[e.status]}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {open && <EntrySheet entry={open} entries={entries} onClose={() => setOpenId(null)} onSent={onOpenFiles} />}
    </>
  );
}

function EntrySheet({ entry: e, entries, onClose, onSent }: { entry: HistoryEntry; entries: HistoryEntry[]; onClose: () => void; onSent: () => void }) {
  const { linkState } = useSession();
  const connected = linkState === 'connected';
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copies, setCopies] = useState<File[]>([]);
  const [viewing, setViewing] = useState<File | null>(null);
  const canResend = e.direction === 'out' && e.kind === 'files';
  const totals = e.peer.id ? peerTotals(entries, e.peer.id) : null;

  useEffect(() => {
    void history.copiesOf(e).then(setCopies);
  }, [e]);

  const dispatch = (files: File[]) => {
    if (!files.length) return;
    const result = history.send(files);
    if ('error' in result) return setError(result.error);
    onClose();
    onSent();
  };

  const pick = async () => {
    if (!canPickWithHandles()) return inputRef.current?.click();
    try {
      dispatch(await pickFilesWithHandles());
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') setError('Dosya seçilemedi.');
    }
  };

  const resend = async () => {
    setError(null);
    if (!e.resendKey) return pick();
    setBusy(true);
    const result = await history.resolve(e);
    setBusy(false);
    if ('error' in result) return setError(result.error);
    dispatch(result.files);
  };

  const when = new Date(e.at).toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
  const verb = e.direction === 'out' ? 'Gönderildi' : 'Alındı';

  return (
    <Sheet label="Kayıt ayrıntısı" onClose={onClose} testId="history-sheet">
      <h2 className="filename">{title(e)}</h2>
      <p className="small muted">
        {when} · {METHOD[e.method]}
      </p>
      <p>
        {e.status === 'done' ? verb : STATUS[e.status]} {e.direction === 'out' ? '→' : '←'} <strong>{e.peer.name}</strong>{' '}
        <span className="muted">· {deviceLabel(e.peer)}</span>
      </p>
      {totals && (totals.sent > 0 || totals.received > 0) && (
        <p className="small muted">
          Bu cihazla toplam: {totals.sent} dosya gönderdin, {totals.received} dosya aldın.
        </p>
      )}

      {e.kind === 'text' && e.textPreview && (
        <>
          <p className="bubble-text history-text">{e.textPreview}</p>
          <CopyButton text={e.textPreview} label="Kopyala" />
        </>
      )}

      {e.files && (
        <ul className="files">
          {e.files.map((f, i) => (
            <li key={i}>
              <Thumb file={copies[i] ?? null} onOpen={() => setViewing(copies[i] ?? null)} size="sm" />
              <span className="filename grow">{f.name}</span>
              <span className="small muted">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {canResend && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            data-testid="resend-input"
            onChange={(ev) => {
              const files = Array.from(ev.target.files ?? []);
              ev.target.value = '';
              dispatch(files);
            }}
          />
          <button type="button" className="btn primary big" onClick={() => void resend()} disabled={busy} data-testid="resend">
            <Icon name="resend" />
            {busy ? 'Hazırlanıyor…' : connected ? 'Yeniden gönder' : 'Bağlanınca gönder'}
          </button>
          {!e.resendKey && (
            <p className="small muted">Bu dosya saklanmadı. Seçiciden aynı dosyayı bulun: {e.files?.map((f) => f.name).join(', ')}</p>
          )}
          {!connected && e.resendKey && <p className="small muted">Bir cihaza bağlanınca otomatik gönderilir; alıcı yine onaylar.</p>}
          {error && (
            <p className="notice error small" role="alert">
              {error}{' '}
              <button type="button" className="link" onClick={() => void pick()}>
                Dosya seç
              </button>
            </p>
          )}
        </>
      )}

      <button type="button" className="link danger" onClick={() => void history.remove(e.id).then(onClose)} data-testid="history-delete">
        <Icon name="trash" /> Kaydı sil
      </button>

      {viewing && <Viewer files={copies} start={viewing} onClose={() => setViewing(null)} />}
    </Sheet>
  );
}
