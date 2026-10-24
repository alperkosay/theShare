import { useSession } from '../hooks/useSession';
import { formatCode } from '../lib/signaling/code-rendezvous';
import { QrCode } from '../components/QrCode';
import { CopyButton, ShareButton } from '../components/CopyButton';
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
        <div className="panel center">
          <p className="small muted">Bağlantı kodunuz</p>
          <p className="pair-code" data-testid="pair-code" data-code={pairCode}>
            {formatCode(pairCode)}
          </p>
          <p className="small muted">Diğer cihazda "Kod gir"e dokunup bu kodu yazsın. Kod 10 dakika geçerli.</p>
          <ShareButton
            title="theShare"
            text={`theShare bağlantı kodum: ${formatCode(pairCode)}`}
            url={link}
            label="Bağlantıyı paylaş"
          />
          <p className="small muted">Paylaşılan bağlantıya tıklayan kişi kod yazmadan bağlanır.</p>
          <CopyButton text={pairCode} label="Sadece kodu kopyala" />
        </div>

        <div className="panel center qr-mini">
          <QrCode text={link} label="Kod QR'ı" />
          <p className="small muted">Yanınızdaysa: telefonun kamerasıyla bu QR'ı okutsun.</p>
        </div>

        <Waiting text="Diğer cihaz bekleniyor…" />
      </>
    );
  }

  return (
    <div className="page">
      <BackButton />
      {content}
    </div>
  );
}
