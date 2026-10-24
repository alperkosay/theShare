import { useEffect, useState } from 'react';
import { session, useSession } from './hooks/useSession';
import { useKeepAlive } from './hooks/useKeepAlive';
import { nearby } from './hooks/useNearby';
import { SIGNAL_HASH_KEY } from './lib/webrtc/signal-codec';
import { normalizeCode } from './lib/signaling/code-rendezvous';
import { HomeScreen } from './screens/HomeScreen';
import { CodeHostScreen } from './screens/CodeHostScreen';
import { CodeJoinScreen } from './screens/CodeJoinScreen';
import { HostScreen } from './screens/HostScreen';
import { JoinScreen } from './screens/JoinScreen';
import { SessionScreen } from './screens/SessionScreen';
import { NearbyConnectScreen } from './screens/NearbyConnectScreen';
import { UpdatePrompt } from './components/UpdatePrompt';

interface UrlInvite {
  /** 6-digit code from …/#k=482913 */
  code: string | null;
  /** QR-mode offer from …/#s=TS1.… */
  offer: string | null;
}

/**
 * Reads an invite from the URL fragment once, then strips it so a reload or
 * the history entry doesn't reuse a stale code. The fragment never reaches
 * the web server.
 */
function takeInviteFromUrl(): UrlInvite {
  if (!location.hash) return { code: null, offer: null };
  const params = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  return {
    code: normalizeCode(params.get('k') ?? ''),
    offer: params.get(SIGNAL_HASH_KEY)?.replace(/\s+/g, '') || null,
  };
}

export function App() {
  const state = useSession();
  const [invite] = useState(takeInviteFromUrl);
  const transferring = state.transfers.some((t) => t.status === 'active' || t.status === 'finishing');

  useKeepAlive(transferring);

  useEffect(() => {
    if (invite.code) session.reset({ role: 'join', method: 'code' });
    else if (invite.offer) session.reset({ role: 'join', method: 'qr' });
  }, [invite]);

  // Nearby discovery runs only on the home screen and while a nearby connection is being set up.
  const discover = !state.wasConnected && (state.role === null || state.method === 'nearby');
  useEffect(() => {
    if (!discover) return;
    nearby.start();
    return () => nearby.stop();
  }, [discover]);

  let screen;
  if (state.wasConnected) screen = <SessionScreen />;
  else if (state.method === 'nearby' && state.role) screen = <NearbyConnectScreen />;
  else if (state.role === 'host') screen = state.method === 'code' ? <CodeHostScreen /> : <HostScreen />;
  else if (state.role === 'join') {
    screen = state.method === 'code' ? <CodeJoinScreen initialCode={invite.code} /> : <JoinScreen initialOffer={invite.offer} />;
  } else screen = <HomeScreen />;

  return (
    <>
      {screen}
      <UpdatePrompt busy={transferring} />
    </>
  );
}
