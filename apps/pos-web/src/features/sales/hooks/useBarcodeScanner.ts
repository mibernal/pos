import { useEffect, useRef } from 'react';

export function useBarcodeScanner(onBarcode: (barcode: string) => void) {
  const buffer = useRef('');
  const lastKeyTime = useRef(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is actively typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      const now = Date.now();
      
      if (e.key === 'Enter') {
        if (buffer.current.length >= 3) {
          onBarcode(buffer.current);
        }
        buffer.current = '';
        return;
      }

      // If more than 50ms passed since last keystroke, it's a human typing, reset buffer
      if (now - lastKeyTime.current > 50) {
        buffer.current = '';
      }

      // Accept printable characters
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        buffer.current += e.key;
        lastKeyTime.current = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBarcode]);
}
