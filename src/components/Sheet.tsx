import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

/**
 * Bottom sheet for forms and details; closes with its X button, a backdrop tap or Escape.
 * Rendered into <body>: the tab's entrance animation transforms its container,
 * which would otherwise trap position: fixed inside it.
 */
export function Sheet({ label, onClose, children, testId }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet glass form" role="dialog" aria-modal="true" aria-label={label} data-testid={testId}>
        {/* Sticky, so the X stays reachable while a long sheet scrolls. */}
        <div className="sheet-head">
          <span className="sheet-grip" aria-hidden="true" />
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Kapat" data-testid="sheet-close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
