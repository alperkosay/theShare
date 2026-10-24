import { useSession } from '../hooks/useSession';
import { nearby, useNearby } from '../hooks/useNearby';
import { Failed, Waiting } from './common';

/** Between picking/accepting a nearby device and the connection being up. */
export function NearbyConnectScreen() {
  const { linkState, error, peerName } = useSession();
  const { outgoing } = useNearby();

  return (
    <div className="page">
      {linkState === 'failed' ? (
        <Failed error={error} />
      ) : (
        <>
          <Waiting text={outgoing?.requestId ? `${peerName ?? 'Diğer cihaz'} onayı bekleniyor…` : `${peerName ?? 'Diğer cihaz'} ile bağlanılıyor…`} />
          <button type="button" className="link" onClick={() => nearby.cancelOutgoing()}>
            Vazgeç
          </button>
        </>
      )}
    </div>
  );
}
