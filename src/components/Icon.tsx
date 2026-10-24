import type { DeviceKind } from '../lib/device';

/** A few stroke icons (24×24, currentColor) so the UI looks the same on every OS, unlike emoji. */
const PATHS = {
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2z',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1M11 18h2',
  tablet: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1M11 18h2',
  computer: 'M4 5h16v11H4zM2 19h20',
  upload: 'M12 16V4M7 9l5-5 5 5M4 15v5h16v-5',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4z',
  clipboard: 'M9 3h6v3H9zM15 4h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  share: 'M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  chevron: 'M9 6l6 6-6 6',
  radar: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7',
  files: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  check: 'M5 12.5l4.5 4.5L19 7',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function DeviceIcon({ kind, className }: { kind: DeviceKind; className?: string }) {
  return <Icon name={kind} {...(className ? { className } : {})} />;
}
