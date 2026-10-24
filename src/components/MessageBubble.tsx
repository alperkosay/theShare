import type { TextMessage } from '../lib/transfer/manager';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';

const time = (ms: number) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Only plain http(s) links get an "open" button; everything is rendered as text, never as HTML. */
function asLink(text: string): string | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed).href;
  } catch {
    return null;
  }
}

export function MessageBubble({ message }: { message: TextMessage }) {
  const link = asLink(message.text);
  return (
    <article className={`bubble ${message.direction}`} data-testid="message" data-direction={message.direction}>
      <p className="bubble-text">{message.text}</p>
      <div className="bubble-meta">
        <span className="small muted">
          {message.direction === 'out' ? 'Gönderildi' : 'Alındı'} · {time(message.at)}
        </span>
        <span className="grow" />
        {link && (
          <a className="link" href={link} target="_blank" rel="noopener noreferrer">
            <Icon name="link" />
            Aç
          </a>
        )}
        <CopyButton text={message.text} label="Kopyala" />
      </div>
    </article>
  );
}
