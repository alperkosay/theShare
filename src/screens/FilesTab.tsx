import { useRef, useState, type CSSProperties } from 'react';
import { session, useSession } from '../hooks/useSession';
import { canZip, defaultZipName, zipFiles } from '../lib/transfer/zip';
import { TransferCard } from '../components/TransferCard';
import { NotConnected, PeerBar } from '../components/PeerBar';
import { Icon } from '../components/Icon';

/** "Files" tab: pick or drop files to send; incoming offers and history. */
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
    return <NotConnected text="Dosya göndermek ve almak için önce bir cihaza bağlanın." onConnect={onOpenDevices} />;
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

  return (
    <>
      <PeerBar onOpen={onOpenDevices} />

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
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (!canSend || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void send(Array.from(e.dataTransfer.files));
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

      <section className="stack" aria-label="Aktarımlar">
        {transfers.length === 0 ? (
          <p className="small muted center">Gönderdiğiniz ve gelen dosyalar burada görünür.</p>
        ) : (
          transfers.map((t, i) => (
            <div key={t.id} className="rise" style={{ '--i': Math.min(i, 6) } as CSSProperties}>
              <TransferCard transfer={t} />
            </div>
          ))
        )}
      </section>
    </>
  );
}
