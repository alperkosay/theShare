import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useSession } from '../hooks/useSession';
import { Icon } from './Icon';

/**
 * Service worker registration. A new version takes over the whole screen and
 * can't be put off: both devices must run the same protocol (an older peer
 * can't pass the verification gate). The one exception is work a reload would
 * destroy: a running transfer or screen share (`busy`) and received files not
 * saved yet. Until those are done, a toast says the update is waiting.
 */
export function UpdatePrompt({ busy }: { busy: boolean }) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);
  const { transfers } = useSession();
  const unsaved = transfers.some((t) => t.received.some((r) => r.file && !r.downloaded));

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    updateRef.current = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });
  }, []);

  if (!needRefresh) return null;
  if (busy || unsaved) {
    return (
      <div className="toast" role="status">
        <span>{unsaved && !busy ? 'Yeni sürüm hazır. Gelen dosyaları kaydedin; ardından uygulama güncellenecek.' : 'Yeni sürüm hazır. Bu iş bitince uygulama güncellenecek.'}</span>
      </div>
    );
  }

  const update = () => {
    setUpdating(true);
    void updateRef.current?.(true);
  };

  return (
    <div className="update-screen" role="alertdialog" aria-modal="true" aria-label="Güncelleme" data-testid="update-screen">
      <div className="update-card">
        <span className="avatar big update-icon">
          <Icon name="resend" />
        </span>
        <h1>Yeni sürüm hazır</h1>
        <p className="muted">theShare güncellendi. Devam etmek için uygulamayı güncelleyin; birkaç saniye sürer. Bağlı bir cihaz varsa bağlantı kesilir, güncellemeden sonra yeniden bağlanabilirsiniz.</p>
        <button type="button" className="btn primary big" onClick={update} disabled={updating} data-testid="update-now">
          {updating ? 'Güncelleniyor…' : 'Şimdi güncelle'}
        </button>
      </div>
    </div>
  );
}
