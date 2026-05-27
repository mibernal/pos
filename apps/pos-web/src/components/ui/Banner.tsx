import type { ReactNode } from 'react';

type BannerTone = 'info' | 'success' | 'error' | 'warning';

interface BannerProps {
  children: ReactNode;
  tone: BannerTone;
  onClose?: () => void;
  action?: ReactNode;
}

export function Banner({ children, tone, onClose, action }: BannerProps) {
  return (
    <div className={`banner banner-${tone}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
      <div style={{ flex: 1 }}>{children}</div>
      {(action || onClose) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
          {action}
          {onClose && (
            <button 
              onClick={onClose} 
              aria-label="Cerrar" 
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '0.25rem', opacity: 0.7, color: 'inherit' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.7')}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
