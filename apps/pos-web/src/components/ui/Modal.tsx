import { useEffect, type ReactNode } from 'react';

export function Modal({
  ariaLabel,
  children,
  onClose,
  size = 'default'
}: {
  ariaLabel: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className={`modal-card ${size === 'wide' ? 'modal-card-wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-content">
          {children}
        </div>
      </div>
    </div>
  );
}
