import { useState, type FormEvent } from 'react';
import { session } from '../hooks/useSession';
import { MAX_TEXT_LENGTH } from '../lib/transfer/protocol';
import { Icon } from './Icon';

/** Send a note, link or the clipboard's contents. */
export function TextComposer({ disabled }: { disabled: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canReadClipboard = typeof navigator.clipboard?.readText === 'function';

  const send = (value: string) => {
    const err = session.sendText(value);
    setError(err);
    return !err;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && send(text)) setText('');
  };

  const sendClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) return setError('Pano boş.');
      send(value);
    } catch {
      setError('Panoya erişilemedi. Metni kutuya yapıştırıp gönderebilirsiniz.');
    }
  };

  return (
    <form className="panel composer" onSubmit={onSubmit}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter sends; plain Enter keeps adding lines.
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSubmit(e);
        }}
        maxLength={MAX_TEXT_LENGTH}
        rows={2}
        placeholder="Metin, bağlantı veya not yazın…"
        aria-label="Gönderilecek metin"
        disabled={disabled}
        data-testid="text-input"
      />
      <div className="row">
        {canReadClipboard && (
          <button type="button" className="btn small" onClick={() => void sendClipboard()} disabled={disabled} data-testid="send-clipboard">
            <Icon name="clipboard" />
            Panodakini gönder
          </button>
        )}
        <span className="grow" />
        <button type="submit" className="btn small primary" disabled={disabled || !text.trim()} data-testid="text-send">
          <Icon name="send" />
          Gönder
        </button>
      </div>
      {error && <p className="small error-text">{error}</p>}
    </form>
  );
}
