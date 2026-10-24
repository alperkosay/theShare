import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { cleanupTemporaryFiles } from './lib/transfer/sinks';
import '@fontsource-variable/space-grotesk';
import './styles.css';

// Remove temporary received files left behind by a tab that was closed mid-session.
void cleanupTemporaryFiles();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
