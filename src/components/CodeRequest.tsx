import { session, useSession } from '../hooks/useSession';
import { deviceLabel } from '../lib/device';
import { DeviceIcon } from './Icon';

/**
 * 6-digit code host: someone who knows the code asks to connect (lib/signaling/code-rendezvous).
 * The code alone could have been overheard or forwarded; the user decides.
 */
export function CodeRequestSheet() {
  const { codeRequest } = useSession();
  if (!codeRequest) return null;
  return (
    <div className="sheet-backdrop">
      <div className="sheet glass" role="alertdialog" aria-label="Bağlantı isteği" data-testid="code-request">
        <span className="sheet-grip" aria-hidden="true" />
        <span className="avatar big pulse">
          <DeviceIcon kind={codeRequest.kind} />
        </span>
        <h2>{codeRequest.name}</h2>
        <p className="muted">{deviceLabel(codeRequest)} kodunuzla bağlanmak istiyor</p>
        <p className="small muted">Kodu siz verdiyseniz kabul edin. Tanımıyorsanız reddedin.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => session.answerCodeRequest(false)} data-testid="code-decline">
            Reddet
          </button>
          <button type="button" className="btn primary" onClick={() => session.answerCodeRequest(true)} data-testid="code-accept">
            Kabul et
          </button>
        </div>
      </div>
    </div>
  );
}
