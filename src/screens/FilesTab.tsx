import { useRef, useState, type CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { history, useHistory } from '../hooks/useHistory';
import { formatBytes } from '../lib/format';
import { canPickWithHandles, filesFromDrop, pickFilesWithHandles } from '../lib/storage/resend';
import { canZip, defaultZipName, zipFiles } from '../lib/transfer/zip';
import { TransferCard } from '../components/TransferCard';
import { NotConnected, PeerBar } from '../components/PeerBar';
import { Icon } from '../components/Icon';

/** "Files" tab: pick or drop files to send; incoming offers, this session's transfers, the pending queue. */
export function FilesTab({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { linkState, wasConnected, transfers } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [asZip, setAsZip] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const connected = linkState === 'connected';
  const sending = zipping || transfers.some((t) => t.direction === 'out' && ['pending', 'active', 'finishing'].includes(t.status));
  const canSend = connected && !sending;

  if (!wasConnected) {
    return (
      <>
        <NotConnected text="Dosya göndermek ve almak için önce bir cihaza bağlanın." onConnect={onOpenDevices} />
        <PendingList connected={false} />
      </>
    );
  }

  const send = async (files: File[]) => {
    if (!files.length || !canSend) return;
    let payload = files;
    if (asZip && canZip(files)) {
      setZipping(true);
      try {
        payload = [await zipFiles(files, defaultZipName())];
      } catch {
        alert('ZIP oluşturulamadı; dosyalar ayrı ayrı gönderilecek.');
      } finally {
        setZipping(false);
      }
    }
    const err = session.sendFiles(payload);
    if (err) alert(err);
  };

  // Chromium desktop: the picker that hands out file handles, so resend needs no stored copy.
  const pick = async () => {
    if (!canPickWithHandles()) return inputRef.current?.click();
    try {
      await send(await pickFilesWithHandles());
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') inputRef.current?.click();
    }
  };

  return (
    <>
      <PeerBar onOpen={onOpenDevices} />

      <div className="files-layout">
        <div className="files-compose">
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void send(files);
            }}
          />
          <button
            type="button"
            className={`dropzone rise${dragging ? ' over' : ''}`}
            disabled={!canSend}
            onClick={() => void pick()}
            onDragOver={(e) => {
              if (!canSend || !e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void filesFromDrop(e.dataTransfer).then(send);
            }}
          >
            <span className="dropzone-icon">
              <Icon name="upload" />
            </span>
            <strong>{zipping ? 'ZIP hazırlanıyor…' : sending ? 'Gönderim sürüyor…' : connected ? 'Dosya gönder' : 'Bağlantı yok'}</strong>
            <span className="small muted">{connected ? 'Dokunun ya da dosyaları buraya bırakın' : 'Yeni gönderim için yeniden bağlanın'}</span>
          </button>

          <label className="check small muted">
            <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} data-testid="zip-toggle" />
            <span className="switch" aria-hidden="true" />
            Birden çok dosyayı tek ZIP olarak gönder
          </label>

          <PendingList connected={connected} />
        </div>

        <section className="stack files-list" aria-label="Aktarımlar">
          {transfers.length === 0 ? (
            <div className="glass empty-list">
              <span className="avatar">
                <Icon name="files" />
              </span>
              <p className="small muted">Gönderdiğiniz ve gelen dosyalar burada görünür.</p>
            </div>
          ) : (
            transfers.map((t, i) => (
              <div key={t.id} className="rise" style={{ '--i': Math.min(i, 6) } as CSSProperties}>
                <TransferCard transfer={t} />
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}

/** Resends waiting for a connection, or for the current send to finish. */
function PendingList({ connected }: { connected: boolean }) {
  const { pending } = useHistory();
  if (!pending.length) return null;
  return (
    <section className="glass pending rise" aria-label="Bekleyenler" data-testid="pending">
      <h2 className="eyebrow">
        {connected ? 'Sırada bekleyen' : 'Bağlanınca gönderilecek'} ({pending.length})
      </h2>
      <ul className="files">
        {pending.map((p) => (
          <li key={p.id}>
            <span className="filename grow">{p.files.length === 1 ? p.files[0]!.name : `${p.files.length} dosya`}</span>
            <span className="small muted">{formatBytes(p.files.reduce((sum, f) => sum + f.size, 0))}</span>
            <button type="button" className="link danger" onClick={() => history.removePending(p.id)}>
              Kaldır
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
