import { useState } from 'react';
import { sdpCandidates, type Candidate } from '../lib/webrtc/signal-codec';
import { session } from '../hooks/useSession';

interface Info {
  local: Candidate[];
  remote: Candidate[];
  pair: { local: string; remote: string } | null;
  maxMessageSize: number;
  connectionState: string;
}

const describe = (c: Candidate) => `${c.type} ${c.address}:${c.port}`;

/** Network details for troubleshooting (and for checking which path a connection took). */
export function Diagnostics() {
  const [info, setInfo] = useState<Info | null>(null);

  const refresh = async () => {
    const link = session.link;
    if (!link) return setInfo(null);
    setInfo({
      local: sdpCandidates(link.localSdp),
      remote: sdpCandidates(link.remoteSdp),
      pair: await link.selectedPair(),
      maxMessageSize: link.maxMessageSize,
      connectionState: link.pc.connectionState,
    });
  };

  return (
    <details
      className="diagnostics small"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void refresh();
      }}
    >
      <summary>Teknik ayrıntılar</summary>
      {info ? (
        <dl>
          <dt>Bağlantı durumu</dt>
          <dd>{info.connectionState}</dd>
          <dt>Kullanılan yol</dt>
          <dd>{info.pair ? `${info.pair.local} ↔ ${info.pair.remote}` : 'henüz yok'}</dd>
          <dt>Bu cihazın adayları</dt>
          <dd>{info.local.length ? info.local.map(describe).join(', ') : 'yok'}</dd>
          <dt>Karşı cihazın adayları</dt>
          <dd>{info.remote.length ? info.remote.map(describe).join(', ') : 'yok'}</dd>
          {info.maxMessageSize > 0 && (
            <>
              <dt>Azami mesaj boyutu</dt>
              <dd>{info.maxMessageSize} bayt</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="muted">Aktif bağlantı yok.</p>
      )}
      <button type="button" className="link" onClick={() => void refresh()}>
        Yenile
      </button>
      <p className="muted">
        <code>.local</code> ile biten adresler tarayıcının yerel IP'nizi gizlemek için kullandığı mDNS adlarıdır. "host ↔ host" yol,
        verinin doğrudan yerel ağ üzerinden aktığını gösterir.
      </p>
    </details>
  );
}
