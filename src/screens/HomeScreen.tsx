import { session } from '../hooks/useSession';
import { NearbyList } from '../components/NearbyList';

export function HomeScreen() {
  return (
    <main className="screen home">
      <div className="hero">
        <img src="./favicon.svg" alt="" width={56} height={56} />
        <h1>theShare</h1>
        <p className="muted">Dosyalar hiçbir sunucuya yüklenmeden doğrudan karşı cihaza gider.</p>
      </div>

      <NearbyList />

      <div className="stack">
        <p className="small muted center">Listede yoksa ya da başka bir ağdaysa kodla bağlanın:</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => session.startCodeHost()} data-testid="start-host">
            Kod oluştur
          </button>
          <button type="button" className="btn" onClick={() => session.reset({ role: 'join', method: 'code' })} data-testid="start-join">
            Kod gir
          </button>
        </div>
      </div>
    </main>
  );
}
