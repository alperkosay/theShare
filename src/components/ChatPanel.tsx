import { useEffect, useRef } from 'react';
import { useSession } from '../hooks/useSession';
import { MessageBubble } from './MessageBubble';
import { TextComposer } from './TextComposer';
import { Icon } from './Icon';

/**
 * Chat beside a screen share. It's the same stream as the Clipboard tab, so
 * nothing said here gets lost when the share ends.
 */
export function ChatPanel({ onClose, compact = false }: { onClose?: () => void; compact?: boolean }) {
  const { messages, linkState } = useSession();
  const listRef = useRef<HTMLDivElement>(null);
  const shown = compact ? messages.slice(-30) : messages;

  // Scroll the list itself (not the page) to the newest message.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown.length]);

  return (
    <aside className={`glass meet-chat${compact ? ' compact' : ''}`} aria-label="Sohbet" data-testid="meet-chat">
      <header className="meet-chat-head">
        <Icon name="chat" />
        <strong className="grow">Sohbet</strong>
        {!compact && <span className="small muted">Pano ile aynı akış</span>}
        {onClose && (
          <button type="button" className="link chat-close" onClick={onClose} aria-label="Sohbeti gizle">
            <Icon name="close" />
          </button>
        )}
      </header>
      <div className="meet-chat-list" ref={listRef}>
        {shown.length ? (
          shown.map((m) => <MessageBubble key={m.id} message={m} />)
        ) : (
          <p className="small muted center chat-empty">Paylaşım sırasında yazdıklarınız burada görünür.</p>
        )}
      </div>
      <TextComposer disabled={linkState !== 'connected'} chat />
    </aside>
  );
}
