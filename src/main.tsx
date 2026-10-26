import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { cleanupTemporaryFiles } from './lib/transfer/sinks';
import { profile } from './hooks/useProfile';
import { history } from './hooks/useHistory';
import { saving } from './hooks/useSaving';
import { trusted } from './hooks/useTrusted';
import { loadDeviceCertificate } from './lib/webrtc/identity';
// Imported early: Chromium may fire its install event before the first render.
import './hooks/useInstall';
import './styles.css';

// Remove temporary received files left behind by a tab that was closed mid-session.
void cleanupTemporaryFiles();

// The profile (name, device id, settings) loads first so the right name shows from the start;
// it gives up quickly if storage is broken. The history can fill in after the first render.
void profile.load().then(() => {
  void history.load();
  void saving.load();
  void trusted.load();
  void loadDeviceCertificate();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
