import { useEffect, useState } from 'react';
import { session, useSession } from './hooks/useSession';
import { useKeepAlive } from './hooks/useKeepAlive';
import { nearby } from './hooks/useNearby';
import { SIGNAL_HASH_KEY } from './lib/webrtc/signal-codec';
import { normalizeCode } from './lib/signaling/code-rendezvous';
import { DevicesTab, type UrlInvite } from './screens/DevicesTab';
import type { AirMode } from './screens/AirScreen';
import { FilesTab } from './screens/FilesTab';
import { ClipboardTab } from './screens/ClipboardTab';
import { HistoryTab } from './screens/HistoryTab';
import { Dock, type Tab } from './components/Dock';
import { RequestSheet } from './components/Radar';
import { UpdatePrompt } from './components/UpdatePrompt';

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
  const [tab, setTab] = useState<Tab>('devices');
  const [air, setAir] = useState<AirMode | null>(null);
  const transferring = state.transfers.some((t) => t.status === 'active' || t.status === 'finishing');

  useKeepAlive(transferring);

  useEffect(() => {
    if (invite.code) session.reset({ role: 'join', method: 'code' });
    else if (invite.offer) session.reset({ role: 'join', method: 'qr' });
  }, [invite]);

  // Nearby discovery runs only on the home screen and while a nearby connection is being set up.
  // Never in zero-connection mode: that one promises no network traffic at all.
  const discover = !air && !state.wasConnected && (state.role === null || state.method === 'nearby');
  useEffect(() => {
    if (!discover) return;
    nearby.start();
    return () => nearby.stop();
  }, [discover]);

  // Jump to Files when a connection comes up, back to Devices when the session ends.
  useEffect(() => {
    setTab(state.wasConnected ? 'files' : 'devices');
  }, [state.wasConnected]);

  // Unread badges for the tabs you're not looking at.
  const incomingTexts = state.messages.filter((m) => m.direction === 'in').length;
  const [seenTexts, setSeenTexts] = useState(0);
  useEffect(() => {
    if (tab === 'clipboard' || incomingTexts === 0) setSeenTexts(incomingTexts);
  }, [tab, incomingTexts]);
  const pendingOffers = state.transfers.filter((t) => t.direction === 'in' && t.status === 'pending').length;

  let content;
  if (tab === 'files') content = <FilesTab onOpenDevices={() => setTab('devices')} />;
  else if (tab === 'clipboard') content = <ClipboardTab onOpenDevices={() => setTab('devices')} />;
  else if (tab === 'history') content = <HistoryTab onOpenFiles={() => setTab('files')} />;
  else content = <DevicesTab invite={invite} air={air} onAir={setAir} />;

  return (
    <div className={`app${transferring ? ' busy' : ''}`} data-testid="link-status" data-state={state.linkState}>
      {/* key: remount per tab so its content plays the entrance animation */}
      <main className={`screen tab-${tab}`} key={tab}>
        {content}
      </main>
      <Dock
        tab={tab}
        onChange={setTab}
        badges={{ files: tab === 'files' ? 0 : pendingOffers, clipboard: tab === 'clipboard' ? 0 : incomingTexts - seenTexts }}
      />
      <RequestSheet />
      <UpdatePrompt busy={transferring} />
    </div>
  );
}
