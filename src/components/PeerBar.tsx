import { useSession } from '../hooks/useSession';
import { deviceLabel } from '../lib/device';
import { DeviceIcon, Icon } from './Icon';
import { VerifyBadge } from './Verify';

/** Compact "who am I connected to" bar shown on top of the Files and Clipboard tabs. */
export function PeerBar({ onOpen }: { onOpen: () => void }) {
  const { linkState, peerName, peer } = useSession();
  const connected = linkState === 'connected';
  return (
    <button type="button" className={`glass peer-bar${connected ? '' : ' off'}`} onClick={onOpen}>
      <span className="avatar">
        <DeviceIcon kind={peer?.kind ?? 'computer'} />
        <span className={`dot ${connected ? 'on' : 'off'}`} aria-hidden="true" />
      </span>
      <span className="grow">
        <strong className="block" data-testid="peer-name">
          {peerName ?? 'Bağlı cihaz'}
        </strong>
        <span className="small muted">
          {peer && <span data-testid="peer-label">{deviceLabel(peer)} · </span>}
          {connected ? 'Bağlı' : 'Bağlantı koptu'}
        </span>
      </span>
      <VerifyBadge />
    </button>
  );
}

export function NotConnected({ text, onConnect }: { text: string; onConnect: () => void }) {
  return (
    <div className="glass empty rise">
      <span className="avatar big">
        <Icon name="radar" />
      </span>
      <h2>Henüz bağlı değilsiniz</h2>
      <p className="muted">{text}</p>
      <button type="button" className="btn primary" onClick={onConnect}>
        Cihaz bağla
      </button>
    </div>
  );
}
