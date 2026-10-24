import { useState } from 'react';
import { session, useSession } from '../hooks/useSession';
import { buildOfferLink } from '../lib/webrtc/signal-codec';
import { QrCode } from '../components/QrCode';
import { CopyButton } from '../components/CopyButton';
import { CodeEntry } from '../components/CodeEntry';
import { BackButton, Failed, Waiting } from './common';

export function HostScreen() {
  const { linkState, localCode, error } = useSession();
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = localCode ? buildOfferLink(location.href, localCode) : null;

  const submitAnswer = async (text: string) => {
    setBusy(true);
    setAnswerError(await session.submitAnswer(text));
    setBusy(false);
  };

  let content;
  if (linkState === 'failed') content = <Failed error={error} />;
  else if (!link) content = <Waiting text="Hazırlanıyor…" />;
  else if (linkState === 'connecting') content = <Waiting text="Bağlanılıyor…" />;
  else {
    content = (
      <>
        <h1 className="title">1. Diğer cihazla bu kodu tarayın</h1>
        <QrCode text={link} label="Bağlantı QR kodu" />
        <CopyButton text={link} label="Bağlantıyı kopyala" />
        <h2 className="title">2. Sonra onun gösterdiği kodu tarayın</h2>
        <CodeEntry scanLabel="Kodu tara" busy={busy} error={answerError} onSubmit={(t) => void submitAnswer(t)} />
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
