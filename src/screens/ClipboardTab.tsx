import { useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';
import { MessageBubble } from '../components/MessageBubble';
import { TextComposer } from '../components/TextComposer';
import { NotConnected, PeerBar } from '../components/PeerBar';

/** "Clipboard" tab: a chat-like stream of texts, links and clipboard contents. */
export function ClipboardTab({ onOpenDevices }: { onOpenDevices: () => void }) {
  const { linkState, wasConnected, messages } = useSession();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (!wasConnected) {
    return <NotConnected text="Metin, bağlantı ya da pano içeriği göndermek için önce bir cihaza bağlanın." onConnect={onOpenDevices} />;
  }

  return (
    <>
      <PeerBar onOpen={onOpenDevices} />
      <section className="chat" aria-label="Mesajlar">
        {messages.length === 0 ? (
          <p className="small muted center chat-empty">
            Yazdığınız ya da panodan gönderdiğiniz her şey karşı cihazda anında belirir.
          </p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={endRef} />
      </section>
      <TextComposer disabled={linkState !== 'connected'} />
    </>
  );
}
