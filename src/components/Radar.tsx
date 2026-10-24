import type { CSSProperties } from 'react';
import { nearby, useNearby } from '../hooks/useNearby';
import { deviceLabel } from '../lib/device';
import { DeviceIcon } from './Icon';

/**
 * This device in the middle with sonar rings; nearby devices pop in on an orbit.
 * Tapping one sends a connection request.
 */
export function Radar() {
  const { status, self, devices, notice } = useNearby();

  let caption: string;
  if (status === 'unavailable') caption = 'Yakındaki cihazlar aranamıyor (internet gerekli). Aşağıdaki yolları kullanın.';
  else if (devices.length > 0) caption = 'Bağlanmak için bir cihaza dokunun.';
  else caption = 'Aynı Wi-Fi\'da theShare\'i açan cihazlar burada belirir…';

  return (
    <section className="glass radar-card" aria-labelledby="radar-title">
      <h2 id="radar-title" className="eyebrow">
        Yakındaki cihazlar
      </h2>

      <div className={`radar${status === 'unavailable' ? ' idle' : ''}`}>
        <span className="ring" style={{ '--d': '0s' } as CSSProperties} />
        <span className="ring" style={{ '--d': '1s' } as CSSProperties} />
        <span className="ring" style={{ '--d': '2s' } as CSSProperties} />
        <span className="orbit-track" aria-hidden="true" />

        <div className="radar-self" data-testid="self-name" data-name={self.name} title={`${self.name} · ${deviceLabel(self)}`}>
          <DeviceIcon kind={self.kind} />
        </div>

        {devices.map((d, i) => {
          // Spread devices evenly around the orbit, starting at the top-right.
          const angle = (i / devices.length) * 2 * Math.PI - Math.PI / 3;
          const style = { '--x': Math.cos(angle).toFixed(3), '--y': Math.sin(angle).toFixed(3), '--i': i } as CSSProperties;
          return (
            <button
              key={d.id}
              type="button"
              className="orbit-device"
              style={style}
              onClick={() => void nearby.connect(d)}
              aria-label={`${d.name} (${deviceLabel(d)}) ile bağlan`}
              data-testid="nearby-device"
              data-name={d.name}
            >
              <span className="orbit-bubble">
                <DeviceIcon kind={d.kind} />
              </span>
              <span className="orbit-name">{d.name}</span>
              <span className="orbit-label">{deviceLabel(d)}</span>
            </button>
          );
        })}
      </div>

      <p className="small muted center">{caption}</p>
      {notice && (
        <p className="notice" role="status" onClick={() => nearby.dismissNotice()}>
          {notice}
        </p>
      )}
      <p className="small muted center">
        Bu cihaz: <strong className="text">{self.name}</strong> · {deviceLabel(self)}
      </p>
    </section>
  );
}

/** Incoming nearby connection request, as a bottom sheet. */
export function RequestSheet() {
  const { incoming } = useNearby();
  if (!incoming) return null;
  return (
    <div className="sheet-backdrop">
      <div className="sheet glass" role="alertdialog" aria-label="Bağlantı isteği" data-testid="nearby-request">
        <span className="sheet-grip" aria-hidden="true" />
        <span className="avatar big pulse">
          <DeviceIcon kind={incoming.from.kind} />
        </span>
        <h2>{incoming.from.name}</h2>
        <p className="muted">{deviceLabel(incoming.from)} bağlanmak istiyor</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => nearby.decline()}>
            Reddet
          </button>
          <button type="button" className="btn primary" onClick={() => void nearby.accept()} data-testid="nearby-accept">
            Kabul et
          </button>
        </div>
      </div>
    </div>
  );
}
