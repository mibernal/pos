import React, { useState, useEffect } from 'react';
import { useBarcodeScanner } from '../../../hooks/useBarcodeScanner';
// Fallback icons
const ScanBarcode = (props: any) => <span>[Scanner]</span>;
const AlertCircle = (props: any) => <span>[!]</span>;

interface ScannerViewProps {
  onScan: (barcode: string) => void;
  isActive?: boolean;
}

const playBeep = (type: 'success' | 'error') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'success') {
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.1);
    } else {
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    }
  } catch (e) {
    console.error('Audio api not supported', e);
  }
};

export const ScannerView: React.FC<ScannerViewProps> = ({ onScan, isActive = true }) => {
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useBarcodeScanner({
    isActive,
    onScan: (barcode) => {
      setLastScanned(barcode);
      setErrorStatus(null);
      // Let the parent decide success or error based on the returned barcode. 
      // For immediate UX, we assume success beep here, but ideally we await a promise from onScan
      onScan(barcode);
    }
  });

  // Expose a global beep helper so the parent can trigger success/error beeps after DB check
  useEffect(() => {
    const handleTriggerBeep = (e: CustomEvent) => {
      playBeep(e.detail.type);
    };
    window.addEventListener('scanner-beep' as any, handleTriggerBeep);
    return () => window.removeEventListener('scanner-beep' as any, handleTriggerBeep);
  }, []);

  return (
    <div className={`p-6 rounded-lg border-2 border-dashed ${isActive ? 'border-primary/50 bg-primary/5' : 'border-muted bg-muted/20'} flex flex-col items-center justify-center space-y-4 transition-colors`}>
      <div className={`p-4 rounded-full ${isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
        <ScanBarcode size={48} />
      </div>

      <div className="text-center">
        <h3 className="text-lg font-semibold">{isActive ? 'Escáner Activo' : 'Escáner Pausado'}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {isActive ? 'Pistolea el código de barras para agregarlo al lote.' : 'El escaneo está temporalmente desactivado.'}
        </p>
      </div>

      {lastScanned && (
        <div className="mt-4 px-4 py-2 bg-background border rounded shadow-sm text-center animate-in fade-in zoom-in duration-200">
          <span className="text-xs text-muted-foreground block mb-1">Último escaneo</span>
          <span className="font-mono font-bold text-lg">{lastScanned}</span>
        </div>
      )}

      {errorStatus && (
        <div className="mt-2 flex items-center text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">
          <AlertCircle size={16} className="mr-2" />
          {errorStatus}
        </div>
      )}
    </div>
  );
};
