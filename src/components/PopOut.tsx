import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '../hooks/useSession';
import { screenShare, useScreenShare } from '../hooks/useScreenShare';
import { ink, useInk } from '../hooks/useInk';
import { popout, usePopout } from '../hooks/usePopout';
import { SurfaceView } from '../screens/Meeting';
import { InkToolbar } from './InkToolbar';
import { ChatPanel } from './ChatPanel';
import { Icon } from './Icon';

/**
 * Renders the pop-out window's content while it's open (it lives at the app
 * level, so it survives switching tabs) and closes it when sharing ends.
 */
export function PopOutHost() {
  const win = usePopout();
  const { local, remote } = useScreenShare();
  const streaming = local !== null || remote !== null;
  useEffect(() => {
    if (win && !streaming) popout.close();
  }, [win, streaming]);
  if (!win || !streaming) return null;
  return createPortal(<PopOutMeeting />, win.document.body);
}

function PopOutMeeting() {
  const { local, remote } = useScreenShare();
  const { peerName } = useSession();
  const { active } = useInk();
  const videoRef = useRef<HTMLVideoElement>(null);
  const surface = remote ? 'remote' : 'local';
  const stream = (remote ?? local)!;
  const name = peerName ?? 'Karşı cihaz';

  return (
    <div className="popout">
      <header className="glass popout-head">
        <span className="live-dot" aria-hidden="true" />
        <strong className="grow ellipsis">{surface === 'remote' ? `${name} ekranı` : 'Ekranınızı sunuyorsunuz'}</strong>
        <button type="button" className={`meet-btn small${active ? ' active' : ''}`} onClick={() => ink.setActive(!active)} aria-pressed={active} title="Çiz">
          <span className="meet-btn-icon">
            <Icon name="draw" />
          </span>
        </button>
        {local && (
          <button type="button" className="meet-btn small danger" onClick={() => screenShare.stop()} title="Paylaşımı durdur">
            <span className="meet-btn-icon">
              <Icon name="stop" />
            </span>
          </button>
        )}
      </header>
      {/* Always muted: the app's own page keeps playing the sound, twice would echo. */}
      <div className="popout-stage">
        <SurfaceView key={surface} surface={surface} stream={stream} videoRef={videoRef} role="main" label={surface === 'remote' ? name : 'Siz'} muted />
      </div>
      {active && <InkToolbar surface={surface} compact />}
      <ChatPanel compact />
    </div>
  );
}
