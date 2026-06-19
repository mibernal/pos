import { useMemo, useState } from 'react';
import { formatMoneyFromCents } from '../../../../lib/format';

interface TipSelectorProps {
  subtotalCents: number;
  tipCents: number;
  onTipChange: (tipCents: number) => void;
}

const TIP_PERCENTAGES = [0, 5, 8, 10, 15];

export function TipSelector({ subtotalCents, tipCents, onTipChange }: TipSelectorProps) {
  const [isManualMode, setIsManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const currentPercentage = useMemo(() => {
    if (tipCents === 0) return 0;
    if (isManualMode) return null;
    
    for (const p of TIP_PERCENTAGES) {
      if (p === 0) continue;
      const expectedTip = Math.round((subtotalCents * p) / 100);
      if (tipCents === expectedTip) {
        return p;
      }
    }
    return null;
  }, [tipCents, subtotalCents, isManualMode]);

  const handlePercentageClick = (percentage: number) => {
    setIsManualMode(false);
    setManualValue('');
    const newTipCents = Math.round((subtotalCents * percentage) / 100);
    onTipChange(newTipCents);
  };

  const handleManualChange = (val: string) => {
    const numericVal = val.replace(/\D/g, '');
    setManualValue(numericVal);
    
    if (numericVal) {
      const parsedTip = parseInt(numericVal, 10) * 100;
      onTipChange(parsedTip);
    } else {
      onTipChange(0);
    }
  };

  const handleToggleManual = () => {
    if (isManualMode) {
      setIsManualMode(false);
      setManualValue('');
      onTipChange(0);
    } else {
      setIsManualMode(true);
      setManualValue(tipCents > 0 ? (tipCents / 100).toString() : '');
    }
  };

  return (
    <div style={{ marginBottom: '1.5rem', background: 'var(--color-bg)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--color-slate-200)' }}>
      <span style={{ fontWeight: 600, color: 'var(--color-slate-900)', display: 'block', marginBottom: '0.5rem' }}>
        Añadir Propina (Opcional)
      </span>
      
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {TIP_PERCENTAGES.map(percentage => (
          <button
            key={percentage}
            type="button"
            style={{
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid var(--color-slate-300)',
              background: currentPercentage === percentage && !isManualMode ? 'var(--color-primary)' : '#fff',
              color: currentPercentage === percentage && !isManualMode ? '#fff' : 'var(--color-slate-700)',
              fontWeight: 600,
              cursor: 'pointer',
              flex: 1,
              minWidth: '50px'
            }}
            onClick={() => handlePercentageClick(percentage)}
          >
            {percentage === 0 ? '0%' : `${percentage}%`}
          </button>
        ))}
        
        <button
          type="button"
          style={{
            padding: '0.5rem 0.75rem',
            borderRadius: '6px',
            border: '1px solid var(--color-slate-300)',
            background: isManualMode ? 'var(--color-primary)' : '#fff',
            color: isManualMode ? '#fff' : 'var(--color-slate-700)',
            fontWeight: 600,
            cursor: 'pointer',
            flex: '2',
            minWidth: '80px'
          }}
          onClick={handleToggleManual}
        >
          Otro Valor
        </button>
      </div>

      {isManualMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 600, color: 'var(--color-slate-700)' }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={manualValue}
            onChange={(e) => handleManualChange(e.target.value)}
            placeholder="Monto de propina (ej. 5000)"
            style={{ flex: 1, padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--color-slate-300)' }}
            autoFocus
          />
        </div>
      )}
      
      {tipCents > 0 && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--color-slate-600)' }}>
          Propina seleccionada: <strong>{formatMoneyFromCents(tipCents)}</strong>
        </div>
      )}
    </div>
  );
}
