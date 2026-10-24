import { useEffect, useRef, useState } from 'react';
import { session, useSession } from '../hooks/useSession';
import { QrCode } from '../components/QrCode';
import { CopyButton } from '../components/CopyButton';
import { CodeEntry } from '../components/CodeEntry';
import { BackButton, Failed, Waiting } from './common';

/** @param initialOffer offer taken from the URL fragment when the app was opened via the QR link. */
export function JoinScreen({ initialOffer }: { initialOffer: string | null }) {
  const { linkState, localCode, error } = useSession();
  const [offerError, setOfferError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoStarted = useRef(false);

  const submitOffer = async (text: string) => {
    setBusy(true);
    setOfferError(await session.startJoin(text));
    setBusy(false);
  };

  useEffect(() => {
    if (initialOffer && !autoStarted.current) {
      autoStarted.current = true;
      void submitOffer(initialOffer);
    }
  }, [initialOffer]);

  let content;
  if (linkState === 'failed') content = <Failed error={error} />;
  else if (linkState === 'gathering' || (initialOffer && busy && !localCode)) content = <Waiting text="Hazırlanıyor…" />;
  else if (!localCode) {
    content = (
      <>
        <h1 className="title">Diğer cihazdaki QR kodu tarayın</h1>
        <CodeEntry
          scanLabel="QR kodu tara"
          autoScan={!initialOffer}
          busy={busy}
          error={offerError}
          onSubmit={(t) => void submitOffer(t)}
        />
      </>
    );
  } else {
    content = (
      <>
        <h1 className="title">Şimdi bu kodu diğer cihazla tarayın</h1>
        <QrCode text={localCode} label="Yanıt QR kodu" />
        <CopyButton text={localCode} label="Kodu kopyala" />
        <Waiting text="Diğer cihaz bekleniyor…" />
      </>
    );
  }

  return (
    <main className="screen" data-testid="link-status" data-state={linkState}>
      <BackButton />
      {content}
    </main>
  );
}
