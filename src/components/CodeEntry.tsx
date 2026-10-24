import { useState, type FormEvent } from 'react';
import { MAX_SIGNAL_TEXT_LENGTH } from '../lib/webrtc/signal-codec';
import { QrScanner } from './QrScanner';

interface Props {
  scanLabel: string;
  /** Open the camera right away instead of showing the scan button first. */
  autoScan?: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (text: string) => void;
}

/** Scan the other device's QR code, or paste its code as a fallback. */
export function CodeEntry({ scanLabel, autoScan = false, busy = false, error, onSubmit }: Props) {
  const [mode, setMode] = useState<'button' | 'scan' | 'paste'>(autoScan ? 'scan' : 'button');
  const [text, setText] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSubmit(text);
  };

  return (
    <div className="stack">
      {mode === 'scan' && (
        <QrScanner
          onResult={(value) => {
            setMode('button');
            onSubmit(value);
          }}
        />
      )}
      {mode === 'button' && (
        <button type="button" className="btn primary big" onClick={() => setMode('scan')} disabled={busy}>
          {busy ? 'Bağlanılıyor…' : scanLabel}
        </button>
      )}
      {mode === 'paste' ? (
        <form onSubmit={submit} className="stack">
          <textarea
            data-testid="code-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_SIGNAL_TEXT_LENGTH}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
            placeholder="Kodu buraya yapıştırın"
          />
          <button type="submit" className="btn primary" disabled={busy || !text.trim()} data-testid="code-submit">
            {busy ? 'Bağlanılıyor…' : 'Devam'}
          </button>
        </form>
      ) : (
        <button type="button" className="link" onClick={() => setMode('paste')} data-testid="paste-toggle">
          Kodu yapıştır
        </button>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
