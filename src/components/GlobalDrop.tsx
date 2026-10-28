import { useEffect, useRef, useState } from 'react';
import { useSession } from '../hooks/useSession';
import { toast, useToast } from '../hooks/useToast';
import { sendFilesNow, sendTextNow } from '../hooks/quickSend';
import { filesFromDrop } from '../lib/storage/resend';
import { Icon } from './Icon';

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') === true;
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** A pasted screenshot arrives as "image.png"; give it a name that says when. */
function namePasted(file: File): File {
  if (file.name && file.name !== 'image.png') return file;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return new File([file], `pano-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`, { type: file.type });
}

interface Pasted {
  text?: string;
  files?: File[];
}

/**
 * Window-wide shortcuts for sending: drop files anywhere (a full-window target
 * appears while dragging), or press Ctrl+V outside a text field. A paste is
 * shown first and sent on Enter: clipboards hold passwords.
 */
export function GlobalDrop() {
  const { linkState, peerName } = useSession();
  const connected = linkState === 'connected';
  const name = peerName ?? 'karşı cihaz';
  const [dragging, setDragging] = useState<number | null>(null);
  const [pasted, setPasted] = useState<Pasted | null>(null);
  const depth = useRef(0);

  // Never let a dropped file navigate away from the app, connected or not.
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging([...(e.dataTransfer?.items ?? [])].filter((i) => i.kind === 'file').length);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(null);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setDragging(null);
      // The Files tab's own drop zone already took it.
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (!connected) return toast.show('Göndermek için önce bir cihaza bağlanın.', 'error');
      void filesFromDrop(e.dataTransfer!, () => toast.show('Klasör ZIP olarak hazırlanıyor…')).then(sendFilesNow, (err: Error) =>
        toast.show(err.message, 'error'),
      );
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    const paste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].map(namePasted);
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (files.length) setPasted({ files });
      else if (text.trim()) setPasted({ text });
      else return;
      e.preventDefault();
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [connected]);

  useEffect(() => {
    if (!connected) setPasted(null);
  }, [connected]);

  const send = () => {
    if (!pasted) return;
    if (pasted.files) sendFilesNow(pasted.files);
    else if (pasted.text) sendTextNow(pasted.text);
    setPasted(null);
  };

  // Enter sends the paste, Escape drops it.
  useEffect(() => {
    if (!pasted) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 'Escape') {
        setPasted(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <>
      {dragging !== null && (
        <div className={`drop-overlay${connected ? '' : ' off'}`} aria-hidden="true">
          <div className="drop-overlay-frame">
            <span className="drop-overlay-icon">
              <Icon name="upload" />
            </span>
            <strong>{connected ? `Bırakın, ${name} cihazına gitsin` : 'Önce bir cihaza bağlanın'}</strong>
            {connected && (
              <span className="muted">{dragging > 1 ? `${dragging} dosya · ` : ''}karşı taraf onaylayınca gönderilir</span>
            )}
          </div>
        </div>
      )}
      {pasted && (
        <div className="glass paste-card" role="dialog" aria-label="Panodakini gönder" data-testid="paste-card">
          <span className="option-icon">
            <Icon name={pasted.files ? 'files' : 'clipboard'} />
          </span>
          <span className="grow paste-body">
            <strong className="block">{name} cihazına gönderilsin mi?</strong>
            <span className="small muted ellipsis block">
              {pasted.files ? pasted.files.map((f) => f.name).join(', ') : pasted.text}
            </span>
          </span>
          <button type="button" className="btn small primary" onClick={send} data-testid="paste-send">
            Gönder <kbd>Enter</kbd>
          </button>
          <button type="button" className="link" onClick={() => setPasted(null)} aria-label="Vazgeç (Esc)">
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}

/** The current toast, if any. */
export function Toasts() {
  const current = useToast();
  if (!current) return null;
  return (
    <div className={`toast app-toast${current.tone === 'error' ? ' error' : ''}`} role="status" key={current.id} data-testid="toast">
      <span>{current.text}</span>
      <button type="button" className="link" onClick={() => toast.dismiss()} aria-label="Kapat">
        <Icon name="close" />
      </button>
    </div>
  );
}
