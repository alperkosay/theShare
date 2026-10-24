import { formatBytes, formatSpeed } from '../lib/format';
import type { TransferStatus, TransferView } from '../lib/transfer/manager';
import { session } from '../hooks/useSession';
import { Icon } from './Icon';

const STATUS: Record<'in' | 'out', Record<TransferStatus, string>> = {
  out: {
    pending: 'Alıcı onayı bekleniyor',
    active: 'Gönderiliyor',
    finishing: 'Kaydediliyor',
    done: 'Gönderildi',
    rejected: 'Reddedildi',
    cancelled: 'İptal edildi',
    failed: 'Başarısız',
  },
  in: {
    pending: 'Gelen dosya',
    active: 'Alınıyor',
    finishing: 'Kaydediliyor',
    done: 'Alındı',
    rejected: 'Reddedildi',
    cancelled: 'İptal edildi',
    failed: 'Başarısız',
  },
};

export function TransferCard({ transfer: t }: { transfer: TransferView }) {
  const manager = session.manager;
  const single = t.files.length === 1;
  const running = t.status === 'active' || t.status === 'finishing';
  const askAccept = t.direction === 'in' && t.status === 'pending';
  const canCancel = running || (t.direction === 'out' && t.status === 'pending');
  const saveable = t.direction === 'in' && t.sinkKind !== 'disk';
  const percent = t.totalBytes > 0 ? (t.transferredBytes / t.totalBytes) * 100 : 0;

  let detail = `${formatBytes(t.totalBytes)} · ${STATUS[t.direction][t.status]}`;
  if (running) detail += ` · ${Math.floor(percent)}% · ${formatSpeed(t.speed)}`;
  if (t.status === 'done' && t.sinkKind === 'disk') detail += ' · seçtiğiniz konuma kaydedildi';

  return (
    <article className={`glass transfer ${t.status}`} data-testid="transfer" data-direction={t.direction} data-status={t.status}>
      <div className="row">
        <span className="arrow" aria-label={t.direction === 'out' ? 'Giden' : 'Gelen'}>
          <Icon name={t.status === 'done' ? 'check' : t.direction === 'out' ? 'arrowUp' : 'arrowDown'} />
        </span>
        <div className="grow">
          <div className="filename">{single ? t.files[0]!.name : `${t.files.length} dosya`}</div>
          <div className="small muted">{detail}</div>
        </div>
        {canCancel && (
          <button type="button" className="link danger" onClick={() => manager?.cancel(t.id)} data-testid="cancel">
            İptal
          </button>
        )}
        {single && saveable && t.received[0]?.file && (
          <SaveButton onClick={() => manager?.download(t.id, 0)} done={t.received[0].downloaded} />
        )}
      </div>

      {running && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {!single && (askAccept || (saveable && t.received.length > 0)) && (
        <ul className="files">
          {t.files.map((f, i) => {
            const r = t.received[i];
            return (
              <li key={i}>
                <span className="filename grow">{f.name}</span>
                <span className="small muted">{formatBytes(f.size)}</span>
                {saveable && r?.file && <SaveButton onClick={() => manager?.download(t.id, i)} done={r.downloaded} />}
              </li>
            );
          })}
        </ul>
      )}

      {askAccept && (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => void manager?.accept(t.id)} data-testid="accept">
            Kabul et
          </button>
          <button type="button" className="btn" onClick={() => manager?.reject(t.id)} data-testid="reject">
            Reddet
          </button>
        </div>
      )}

      {t.status === 'failed' && t.error && <p className="small error-text">{t.error}</p>}
    </article>
  );
}

function SaveButton({ onClick, done }: { onClick: () => void; done: boolean }) {
  return (
    <button type="button" className="btn small primary" onClick={onClick} data-testid="download">
      {done ? 'Tekrar kaydet' : 'Kaydet'}
    </button>
  );
}
