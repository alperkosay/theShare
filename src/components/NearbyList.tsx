import { nearby, useNearby } from '../hooks/useNearby';
import type { DeviceKind } from '../lib/signaling/nearby';

const KIND_ICON: Record<DeviceKind, string> = { phone: '📱', tablet: '📱', computer: '💻' };
const KIND_LABEL: Record<DeviceKind, string> = { phone: 'telefon', tablet: 'tablet', computer: 'bilgisayar' };

export function NearbyList() {
  const { status, self, devices, incoming, notice } = useNearby();

  return (
    <section className="stack" aria-labelledby="nearby-title">
      {incoming && (
        <div className="request" role="alertdialog" aria-label="Bağlantı isteği" data-testid="nearby-request">
          <p>
            <strong>
              {KIND_ICON[incoming.from.kind]} {incoming.from.name}
            </strong>{' '}
            bağlanmak istiyor
          </p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void nearby.accept()} data-testid="nearby-accept">
              Kabul et
            </button>
            <button type="button" className="btn" onClick={() => nearby.decline()}>
              Reddet
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="notice" role="status" onClick={() => nearby.dismissNotice()}>
          {notice}
        </p>
      )}

      <div className="row">
        <h2 id="nearby-title" className="grow section-label">
          Yakındaki cihazlar
        </h2>
        {status === 'searching' || (status === 'active' && devices.length === 0) ? <span className="mini-spinner" aria-hidden="true" /> : null}
      </div>

      {devices.length > 0 ? (
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.id}>
              <button type="button" className="device" onClick={() => void nearby.connect(d)} data-testid="nearby-device" data-name={d.name}>
                <span className="device-icon" aria-hidden="true">
                  {KIND_ICON[d.kind]}
                </span>
                <span className="grow">
                  <span className="device-name">{d.name}</span>
                  <span className="small muted"> · {KIND_LABEL[d.kind]}</span>
                </span>
                <span className="muted" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">
          {status === 'unavailable'
            ? 'Yakındaki cihazlar aranamıyor (internet bağlantısı gerekli). Kodla bağlanabilirsiniz.'
            : 'Aynı Wi-Fi ağında theShare\'i açan cihazlar burada görünür.'}
        </p>
      )}

      <p className="small muted" data-testid="self-name" data-name={self.name}>
        Bu cihaz: <strong>{self.name}</strong>
      </p>
    </section>
  );
}
