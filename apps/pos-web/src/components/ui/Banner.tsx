import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

type BannerTone = 'info' | 'success' | 'error' | 'warning';

interface BannerProps {
  children: ReactNode;
  tone: BannerTone;
  onClose?: () => void;
  action?: ReactNode;
  className?: string;
}

export function Banner({ children, tone, onClose, action, className }: BannerProps) {
  const baseClasses = "flex justify-between items-center gap-4 p-4 rounded-xl border text-sm font-medium animate-in fade-in duration-200";
  
  const toneClasses = {
    info: "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900/50",
    success: "bg-green-50 text-green-800 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-900/50",
    error: "bg-destructive/10 text-destructive border-destructive/20",
    warning: "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-300 dark:border-yellow-900/50",
  };

  return (
    <div className={twMerge(clsx(baseClasses, toneClasses[tone], className))}>
      <div className="flex-1">{children}</div>
      {(action || onClose) && (
        <div className="flex items-center gap-3 shrink-0">
          {action}
          {onClose && (
            <button 
              onClick={onClose} 
              aria-label="Cerrar" 
              className="text-current opacity-70 hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
