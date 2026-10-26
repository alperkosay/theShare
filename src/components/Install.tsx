import { useEffect, useState } from 'react';
import { install, useInstall } from '../hooks/useInstall';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Sheet } from './Sheet';

/** Wait a moment after the home screen settles before suggesting the install. */
const FIRST_RUN_DELAY_MS = 1200;

function IosSteps() {
  return (
    <ol className="install-steps">
      <li>
        Safari'de alttaki <strong>Paylaş</strong> düğmesine dokun <Icon name="share" />
      </li>
      <li>
        Listeden <strong>Ana Ekrana Ekle</strong>'yi seç
      </li>
      <li>
        Sağ üstteki <strong>Ekle</strong>'ye dokun
      </li>
    </ol>
  );
}

/**
 * One-time suggestion on the first visit to install theShare as an app.
 * Only where installing is actually possible (Chromium's prompt, or iOS by hand),
 * and only on the home screen so it never covers a pairing in progress.
 */
export function InstallPrompt({ home }: { home: boolean }) {
  const way = useInstall();
  const [open, setOpen] = useState(false);
  const eligible = home && (way === 'prompt' || way === 'ios') && !install.seen;

  useEffect(() => {
    if (!eligible) return;
    const timer = setTimeout(() => setOpen(true), FIRST_RUN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [eligible]);

  if (!open) return null;
  const close = () => {
    install.markSeen();
    setOpen(false);
  };

  return (
    <Sheet label="Uygulamayı yükle" onClose={close} testId="install-prompt">
      <div className="install-hero">
        <Logo size={56} />
        <h2>theShare'i uygulama olarak yükle</h2>
        <p className="small muted">Ana ekrandan tek dokunuşla açılır, tam ekran çalışır ve internetsiz QR modu çevrimdışı da açılır.</p>
      </div>
      {way === 'ios' ? (
        <>
          <IosSteps />
          <button type="button" className="btn primary big" onClick={close}>
            Anladım
          </button>
        </>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              install.markSeen();
              void install.install().finally(() => setOpen(false));
            }}
            data-testid="install-accept"
          >
            Yükle
          </button>
          <button type="button" className="btn" onClick={close}>
            Şimdi değil
          </button>
        </div>
      )}
      <p className="small muted center">Daha sonra profilinden de yükleyebilirsin.</p>
    </Sheet>
  );
}

/** "App" section of the settings: install button, iOS steps, or "installed". */
export function InstallSection() {
  const way = useInstall();
  return (
    <>
      <h2 className="eyebrow">Uygulama</h2>
      {way === 'installed' ? (
        <p className="small muted">
          <Icon name="check" /> theShare bu cihazda uygulama olarak yüklü.
        </p>
      ) : way === 'prompt' ? (
        <>
          <button type="button" className="btn primary" onClick={() => void install.install()} data-testid="install-app">
            <Icon name="arrowDown" /> Uygulamayı yükle
          </button>
          <p className="small muted">Ana ekrandan açılır, tam ekran ve çevrimdışı çalışır.</p>
        </>
      ) : way === 'ios' ? (
        <>
          <p className="small muted">Ana ekrana eklersen uygulama gibi tam ekran açılır:</p>
          <IosSteps />
        </>
      ) : (
        <p className="small muted">
          Tarayıcının menüsünde <strong>Uygulamayı yükle</strong> ya da <strong>Ana ekrana ekle</strong> seçeneği varsa onunla yükleyebilirsin. Firefox
          masaüstü bunu desteklemiyor.
        </p>
      )}
    </>
  );
}
