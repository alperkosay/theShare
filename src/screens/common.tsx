import { session } from '../hooks/useSession';
import { Diagnostics } from '../components/Diagnostics';

export function BackButton() {
  return (
    <button type="button" className="link back" onClick={() => session.reset()}>
      ← Geri
    </button>
  );
}

export function Waiting({ text }: { text: string }) {
  return (
    <div className="waiting">
      <div className="spinner" aria-hidden="true" />
      <p className="muted">{text}</p>
    </div>
  );
}

export function Failed({ error }: { error: string | null }) {
  return (
    <div className="stack center" role="alert">
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
