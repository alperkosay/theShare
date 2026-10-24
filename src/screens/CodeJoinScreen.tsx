import { useEffect, useRef, useState } from 'react';
import { session, useSession } from '../hooks/useSession';
import { normalizeCode } from '../lib/signaling/code-rendezvous';
import { BackButton, Failed, Waiting } from './common';

/** @param initialCode code taken from the URL (…/#k=482913) when opened via the QR. */
export function CodeJoinScreen({ initialCode }: { initialCode: string | null }) {
  const { linkState, error } = useSession();
  const [value, setValue] = useState(initialCode ?? '');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);

  const connect = async (input: string) => {
    setBusy(true);
    setCodeError(null);
    setCodeError(await session.joinCode(input));
    setBusy(false);
  };

  useEffect(() => {
    if (initialCode && !autoStarted.current) {
      autoStarted.current = true;
      void connect(initialCode);
    }
  }, [initialCode]);

  if (linkState === 'failed') {
    return (
      <main className="screen" data-testid="link-status" data-state={linkState}>
        <BackButton />
        <Failed error={error} />
      </main>
    );
  }

  return (
    <main className="screen" data-testid="link-status" data-state={linkState}>
      <BackButton />
      {busy ? (
        <Waiting text="Bağlanılıyor…" />
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(value);
          }}
        >
          <h1 className="title">Diğer cihazdaki kodu girin</h1>
          <input
            className="code-input"
            data-testid="pair-code-input"
            value={value}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d\s]/g, '').slice(0, 7);
              setValue(next);
              // Connect as soon as all six digits are in.
              if (normalizeCode(next)) void connect(next);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder="000 000"
            aria-label="6 haneli kod"
          />
          <button type="submit" className="btn primary big" disabled={!normalizeCode(value)}>
            Bağlan
          </button>
          {codeError && (
            <p className="notice error" role="alert">
              {codeError}
            </p>
          )}
        </form>
      )}
      <button type="button" className="link" onClick={() => session.reset({ role: 'join', method: 'qr' })} data-testid="qr-fallback">
        İnternet yok mu? QR ile bağlan
      </button>
    </main>
  );
}
