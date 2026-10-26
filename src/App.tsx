import { useEffect, useState } from 'react';
import { session, useSession } from './hooks/useSession';
import { useKeepAlive } from './hooks/useKeepAlive';
import { nearby } from './hooks/useNearby';
import { rooms } from './hooks/useRooms';
import { SIGNAL_HASH_KEY } from './lib/webrtc/signal-codec';
import { normalizeCode } from './lib/signaling/code-rendezvous';
import { DevicesTab, type UrlInvite } from './screens/DevicesTab';
import type { AirMode } from './screens/AirScreen';
import { FilesTab } from './screens/FilesTab';
import { ClipboardTab } from './screens/ClipboardTab';
import { HistoryTab } from './screens/HistoryTab';
import { ScreenTab } from './screens/ScreenTab';
import { useScreenShare } from './hooks/useScreenShare';
import { ScreenAskPrompt, ScreenMini } from './components/ScreenShare';
import { PopOutHost } from './components/PopOut';
import { CommandPalette } from './components/CommandPalette';
import { GlobalDrop, Toasts } from './components/GlobalDrop';
import { usePopout } from './hooks/usePopout';
import { Dock, type Tab } from './components/Dock';
import { RequestSheet } from './components/Radar';
import { UpdatePrompt } from './components/UpdatePrompt';
import { InstallPrompt } from './components/Install';

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
  const screen = useScreenShare();
  const streaming = screen.local !== null || screen.remote !== null;
  const popoutOpen = usePopout() !== null;

  // A share also needs the screen on (and the page open) to keep going.
  useKeepAlive(transferring || streaming);

  useEffect(() => {
    // Our own room's link (e.g. opened again from the chat we shared it in) reopens the room instead of joining it.
    if (invite.code && rooms.isOwn(invite.code)) session.startCodeHost(invite.code);
    else if (invite.code) session.reset({ role: 'join', method: 'code' });
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
  // The meeting's chat and the hub's feed show the same messages, so they count as seen there too.
  const textsVisible = tab === 'clipboard' || (tab === 'screen' && streaming) || (tab === 'devices' && state.wasConnected);
  useEffect(() => {
    if (textsVisible || incomingTexts === 0) setSeenTexts(incomingTexts);
  }, [textsVisible, incomingTexts]);
  const pendingOffers = state.transfers.filter((t) => t.direction === 'in' && t.status === 'pending').length;

  let content;
  if (tab === 'files') content = <FilesTab onOpenDevices={() => setTab('devices')} />;
  else if (tab === 'clipboard') content = <ClipboardTab onOpenDevices={() => setTab('devices')} />;
  else if (tab === 'screen') content = <ScreenTab onOpenDevices={() => setTab('devices')} />;
  else if (tab === 'history') content = <HistoryTab onOpenFiles={() => setTab('files')} />;
  else content = <DevicesTab invite={invite} air={air} onAir={setAir} onOpen={setTab} />;

  // Desktop: pairing flows stay a narrow column; everything else uses the width.
  const wide = tab !== 'devices' || state.wasConnected || (!air && state.role === null);

  return (
    <div className={`app${transferring ? ' busy' : ''}`} data-testid="link-status" data-state={state.linkState}>
      {/* key: remount per tab so its content plays the entrance animation */}
      <main className={`screen tab-${tab}${wide ? ' wide' : ''}${tab === 'screen' && streaming ? ' meeting' : ''}`} key={tab}>
        {content}
      </main>
      <Dock
        tab={tab}
        onChange={setTab}
        badges={{
          files: tab === 'files' ? 0 : pendingOffers,
          clipboard: textsVisible ? 0 : incomingTexts - seenTexts,
          screen: tab !== 'screen' && screen.remote ? 'live' : 0,
        }}
      />
      {tab !== 'screen' && !popoutOpen && <ScreenMini onOpen={() => setTab('screen')} />}
      <PopOutHost />
      <ScreenAskPrompt onShare={() => setTab('screen')} />
      <GlobalDrop />
      <CommandPalette onOpen={setTab} />
      <Toasts />
      <RequestSheet />
      <UpdatePrompt busy={transferring} />
      <InstallPrompt home={tab === 'devices' && !air && state.role === null && !state.wasConnected} />
    </div>
  );
}
