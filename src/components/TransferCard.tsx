import { useState } from 'react';
import { formatBytes, formatSpeed } from '../lib/format';
import { selfDevice } from '../lib/device';
import type { TransferStatus, TransferView } from '../lib/transfer/manager';
import { savedLabel } from '../lib/transfer/save';
import { canZip } from '../lib/transfer/zip';
import { session, useSession } from '../hooks/useSession';
import { saving, useSaveTarget } from '../hooks/useSaving';
import { Icon } from './Icon';
import { Thumb, Viewer } from './Preview';

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
  const { autoAccept } = useSession();
  const target = useSaveTarget();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const single = t.files.length === 1;
  const running = t.status === 'active' || t.status === 'finishing';
  const askAccept = t.direction === 'in' && t.status === 'pending';
  const canCancel = running || (t.direction === 'out' && t.status === 'pending');
  const saveable = t.direction === 'in' && t.sinkKind !== 'disk';
  const percent = t.totalBytes > 0 ? (t.transferredBytes / t.totalBytes) * 100 : 0;
  const [viewing, setViewing] = useState<File | null>(null);

  // What can be previewed: what we're sending, or what has arrived in the browser (not straight to disk).
  const fileAt = (i: number): File | null => (t.direction === 'out' ? (t.sources[i] ?? null) : (t.received[i]?.file ?? null));
  const available = t.files.map((_, i) => fileAt(i)).filter((f): f is File => f !== null);
  const savable = saveable ? t.received.flatMap((r, i) => (r.file ? [i] : [])) : [];
  const unsaved = savable.filter((i) => !t.received[i]!.downloaded);
  const anySaved = savable.length > unsaved.length;

  // Called straight from clicks: the share sheet and folder permission need the user activation.
  const save = (indices: number[]) => {
    setSaveError(null);
    void saving.saveReceived(t, indices).then(setSaveError);
  };
  const saveZip = () => {
    setSaveError(null);
    setZipping(true);
    void saving.saveAsZip(t).then((error) => {
      setZipping(false);
      setSaveError(error);
    });
  };

  let detail = `${formatBytes(t.totalBytes)} · ${STATUS[t.direction][t.status]}`;
  if (running) detail += ` · ${Math.floor(percent)}% · ${formatSpeed(t.speed)}`;
  if (t.status === 'done' && t.sinkKind === 'disk') {
    detail += target.mode === 'folder' && target.folder ? ` · "${target.folder.name}" klasörüne kaydedildi` : ' · seçtiğiniz konuma kaydedildi';
  }
  const where = anySaved ? savedLabel(target.mode, selfDevice().os, target.folder?.name ?? null) : null;

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
        {single && <Thumb file={fileAt(0)} onOpen={() => setViewing(fileAt(0))} />}
        {single && saveable && t.received[0]?.file && (
          <SaveButton onClick={() => save([0])} done={t.received[0].downloaded} />
        )}
      </div>

      {running && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <div className="progress-bar" style={{ width: `${percent}%` }} />
        </div>
      )}

      {!single && (askAccept || t.direction === 'out' || (saveable && t.received.length > 0)) && (
        <ul className="files">
          {t.files.map((f, i) => {
            const r = t.received[i];
            return (
              <li key={i}>
                <Thumb file={fileAt(i)} onOpen={() => setViewing(fileAt(i))} size="sm" />
                <span className="filename grow">{f.name}</span>
                <span className="small muted">{formatBytes(f.size)}</span>
                {saveable && r?.file && <SaveButton onClick={() => save([i])} done={r.downloaded} />}
              </li>
            );
          })}
        </ul>
      )}

      {!single && savable.length > 1 && (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => save(unsaved.length ? unsaved : savable)} data-testid="download-all">
            <Icon name="arrowDown" /> {unsaved.length ? `Tümünü kaydet (${unsaved.length})` : 'Tümünü tekrar kaydet'}
          </button>
          {target.mode !== 'folder' && canZip(savable.map((i) => t.received[i]!.file!)) && (
            <button type="button" className="btn" onClick={saveZip} disabled={zipping} data-testid="download-zip">
              {zipping ? 'ZIP hazırlanıyor…' : 'ZIP olarak'}
            </button>
          )}
        </div>
      )}

      {askAccept && (
        <>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void manager?.accept(t.id)} data-testid="accept">
              {single ? 'Kabul et' : `Tümünü kabul et (${t.files.length})`}
            </button>
            <button type="button" className="btn" onClick={() => manager?.reject(t.id)} data-testid="reject">
              Reddet
            </button>
          </div>
          <label className="check small muted">
            <input type="checkbox" checked={autoAccept} onChange={(e) => session.setAutoAccept(e.target.checked)} data-testid="auto-accept" />
            <span className="switch" aria-hidden="true" />
            Bu bağlantıda sonraki gönderimleri sormadan kabul et
          </label>
        </>
      )}

      {where && <p className="small muted">{where}</p>}
      {saveError && (
        <p className="small error-text" role="alert">
          {saveError}
        </p>
      )}
      {t.status === 'failed' && t.error && <p className="small error-text">{t.error}</p>}

      {viewing && (
        <Viewer
          files={available}
          start={viewing}
          onClose={() => setViewing(null)}
          action={(_, index) => {
            const i = t.received.findIndex((r) => r.file === available[index]);
            return saveable && i >= 0 ? <SaveButton onClick={() => save([i])} done={t.received[i]!.downloaded} /> : null;
          }}
        />
      )}
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
