import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker registration with an explicit "reload" prompt. Updates are
 * never applied silently: reloading mid-transfer would drop the connection.
 */
export function UpdatePrompt({ busy }: { busy: boolean }) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    updateRef.current = registerSW({ onNeedRefresh: () => setNeedRefresh(true) });
  }, []);

  if (!needRefresh || busy) return null;
  return (
    <div className="toast" role="status">
      <span>Yeni sürüm hazır.</span>
      <button type="button" className="btn small primary" onClick={() => void updateRef.current?.(true)}>
        Yenile
      </button>
      <button type="button" className="link" onClick={() => setNeedRefresh(false)}>
        Sonra
      </button>
    </div>
  );
}
