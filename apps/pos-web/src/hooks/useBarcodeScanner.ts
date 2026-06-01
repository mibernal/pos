import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
  onError?: (error: Error) => void;
  timeThreshold?: number; // max time between keystrokes (ms)
  minLength?: number; // minimum length of a valid barcode
  isActive?: boolean; // if false, ignores scans
}

export function useBarcodeScanner({
  onScan,
  onError,
  timeThreshold = 50,
  minLength = 3,
  isActive = true,
}: UseBarcodeScannerOptions) {
  const buffer = useRef<string>('');
  const lastKeyTime = useRef<number>(0);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input, textarea, etc (unless we specifically want to intercept it, but usually scanners intercept globally when not focused on text inputs, or we force focus on an invisible input. Better approach for global: check activeElement)
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }

      const currentTime = performance.now();
      const timeDiff = currentTime - lastKeyTime.current;

      // If time between keystrokes is too long, it's likely human typing, so clear buffer
      if (timeDiff > timeThreshold && buffer.current.length > 0) {
        buffer.current = '';
      }

      if (e.key === 'Enter') {
        if (buffer.current.length >= minLength) {
          // Scanner finished reading
          onScan(buffer.current);
          buffer.current = '';
        } else {
          // Not enough characters, clear buffer
          buffer.current = '';
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only append single printable characters
        buffer.current += e.key;
      }

      lastKeyTime.current = currentTime;
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onScan, onError, timeThreshold, minLength, isActive]);
}
