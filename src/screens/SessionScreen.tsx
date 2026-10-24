import { useRef, useState } from 'react';
import { session, useSession } from '../hooks/useSession';
import { canZip, defaultZipName, zipFiles } from '../lib/transfer/zip';
import { TransferCard } from '../components/TransferCard';

/** Connected (or previously connected) session: send, receive, history. */
export function SessionScreen() {
  const { linkState, error, pairingCode, transfers } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [asZip, setAsZip] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const connected = linkState === 'connected';
  const sending = zipping || transfers.some((t) => t.direction === 'out' && ['pending', 'active', 'finishing'].includes(t.status));
  const canSend = connected && !sending;

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

  const leave = () => {
    const unsaved = transfers.some((t) => t.received.some((r) => r.file && !r.downloaded));
    if (unsaved && !confirm('Kaydedilmemiş dosyalar silinecek. Çıkılsın mı?')) return;
    session.leave();
  };

  return (
    <main
      className={`screen${dragging ? ' dragging' : ''}`}
      data-testid="link-status"
      data-state={linkState}
      onDragOver={(e) => {
        if (!canSend || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void send(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="row">
        <div className="grow">
          <strong className={connected ? 'ok-text' : 'error-text'}>● {connected ? 'Bağlandı' : 'Bağlantı koptu'}</strong>
          {connected && pairingCode && (
            <div className="small muted">
              Güvenlik kodu <span data-testid="pairing-code">{pairingCode}</span> · iki ekranda aynı olmalı
            </div>
          )}
        </div>
        <button type="button" className="link danger" onClick={leave} data-testid="leave">
          {connected ? 'Bağlantıyı kes' : 'Çık'}
        </button>
      </header>

      {!connected && error && <p className="notice error">{error}</p>}

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
      <div className="stack">
        <button type="button" className="btn primary big" disabled={!canSend} onClick={() => inputRef.current?.click()}>
          {zipping ? 'ZIP hazırlanıyor…' : sending ? 'Gönderim sürüyor…' : 'Dosya gönder'}
        </button>
        <label className="check small muted">
          <input type="checkbox" checked={asZip} onChange={(e) => setAsZip(e.target.checked)} data-testid="zip-toggle" />
          Birden çok dosyayı tek ZIP olarak gönder
        </label>
      </div>

      {transfers.length === 0 ? (
        <p className="small muted center">Dosyaları buraya sürükleyip bırakabilirsiniz.</p>
      ) : (
        <div className="stack">
          {transfers.map((t) => (
            <TransferCard key={t.id} transfer={t} />
          ))}
        </div>
      )}
    </main>
  );
}
