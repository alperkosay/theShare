import { useMemo } from 'react';
import { createQr } from '../lib/qr/generate';

interface Props {
  text: string;
  label: string;
}

export function QrCode({ text, label }: Props) {
  const qr = useMemo(() => createQr(text), [text]);
  if (!qr) {
    return (
      <p className="notice" data-testid="qr-code" data-code={text}>
        Bu kod QR için fazla uzun. Kopyalayıp diğer cihaza metin olarak aktarın.
      </p>
    );
  }
  // Always dark-on-light with a quiet zone, regardless of theme: inverted QR codes scan poorly.
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      data-testid="qr-code"
      data-code={text}
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}
