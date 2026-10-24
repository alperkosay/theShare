import { session, useSession } from '../hooks/useSession';
import { formatCode } from '../lib/signaling/code-rendezvous';
import { QrCode } from '../components/QrCode';
import { BackButton, Failed, Waiting } from './common';

export function CodeHostScreen() {
  const { linkState, pairCode, error } = useSession();
  const link = pairCode ? `${location.href.split('#')[0]}#k=${pairCode}` : null;

  let content;
  if (linkState === 'failed') content = <Failed error={error} />;
  else if (!pairCode || !link) content = <Waiting text="Hazırlanıyor…" />;
  else if (linkState !== 'idle') content = <Waiting text="Bağlanılıyor…" />;
  else {
    content = (
      <>
        <h1 className="title">Diğer cihazda bu kodu girin</h1>
        <p className="pair-code" data-testid="pair-code" data-code={pairCode}>
          {formatCode(pairCode)}
        </p>
        <QrCode text={link} label="Kod QR'ı" />
        <p className="small muted center">veya bu QR'ı telefonun kamerasıyla okutun</p>
        <Waiting text="Diğer cihaz bekleniyor…" />
      </>
    );
  }

  return (
    <main className="screen" data-testid="link-status" data-state={linkState}>
      <BackButton />
      {content}
      <button type="button" className="link" onClick={() => void session.startHost()} data-testid="qr-fallback">
        İnternet yok mu? QR ile bağlan
      </button>
    </main>
  );
}
