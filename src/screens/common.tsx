import { session } from '../hooks/useSession';
import { Diagnostics } from '../components/Diagnostics';
import { Icon } from '../components/Icon';

export function BackButton() {
  return (
    <button type="button" className="link back" onClick={() => session.reset()}>
      ← Geri
    </button>
  );
}

export function Waiting({ text }: { text: string }) {
  return (
    <div className="waiting" role="status">
      <div className="orbit-loader" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="muted">{text}</p>
    </div>
  );
}

export function Failed({ error }: { error: string | null }) {
  return (
    <div className="glass failed rise" role="alert">
      <span className="avatar big danger">
        <Icon name="close" />
      </span>
      <h1 className="title">Bağlanılamadı</h1>
      <p className="muted">{error ?? 'Bilinmeyen bir hata oluştu.'}</p>
      <button type="button" className="btn primary big" onClick={() => session.retry()} data-testid="retry">
        Tekrar dene
      </button>
      <p className="small muted">İki cihazda da baştan başlayın.</p>
      <Diagnostics />
    </div>
  );
}
