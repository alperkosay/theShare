import { useState } from 'react';
import { Icon } from './Icon';

interface Props {
  text: string;
  label: string;
  className?: string;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for insecure contexts and older browsers.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label, className = 'link' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onClick = async () => {
    setState((await copyText(text)) ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button type="button" className={className} onClick={onClick}>
      <Icon name="copy" />
      {state === 'copied' ? 'Kopyalandı ✓' : state === 'failed' ? 'Kopyalanamadı' : label}
    </button>
  );
}

/** Opens the OS share sheet (WhatsApp, Messages…) where available, otherwise copies. */
export function ShareButton({ title, text, url, label }: { title: string; text: string; url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';

  const onClick = async () => {
    if (canShare) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    if (await copyText(`${text}\n${url}`)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button type="button" className="btn primary big" onClick={() => void onClick()} data-testid="share-code">
      <Icon name={canShare ? 'share' : 'link'} />
      {copied ? 'Bağlantı kopyalandı ✓' : label}
    </button>
  );
}
