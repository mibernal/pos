import { useState } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { formatMoneyFromCents } from '../../../lib/format';
import type { PosApiClient } from '../../../types';

export function CloseCashSessionModal({
  api,
  isOpen,
  sessionId,
  onClose,
  onSuccess
}: {
  api: PosApiClient;
  isOpen: boolean;
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [closingCashRealPesos, setClosingCashRealPesos] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    expected_cash_cents: number;
    diff_cents: number;
  } | null>(null);

  if (!isOpen) {
    return null;
  }

  async function handleCloseSession() {
    const rawVal = Number(closingCashRealPesos);
    if (isNaN(rawVal) || rawVal < 0) {
      setError('Ingresa un monto válido');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.closeCashSession(sessionId, rawVal * 100);
      setSummary(result.summary);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cerrar la caja');
      setLoading(false);
    }
  }

  function handleFinish() {
    onSuccess();
    setSummary(null);
    setClosingCashRealPesos('');
  }

  return (
    <Modal ariaLabel="Cerrar Caja" onClose={summary ? handleFinish : onClose}>
      <div className="stack-md">
        <div className="section-heading">
          <div>
            <h3>Cerrar Sesión de Caja</h3>
            <p>Arqueo de caja y cierre operativo.</p>
          </div>
        </div>

        {summary ? (
          <div className="stack-md">
            <Banner tone="info">
              <strong style={{ display: 'block', fontSize: '1rem', marginBottom: '0.25rem' }}>Caja Cerrada Exitosamente</strong>
              <p>El arqueo ha finalizado, revisa el resumen.</p>
            </Banner>

            <div className="detail-card">
              <div className="detail-item-row">
                <span>Total Esperado (COP)</span>
                <strong>{formatMoneyFromCents(summary.expected_cash_cents)}</strong>
              </div>
              <div className="detail-item-row">
                <span>Diferencia</span>
                <strong style={{ color: summary.diff_cents < 0 ? 'var(--color-error-600)' : summary.diff_cents > 0 ? 'var(--color-success-600)' : 'inherit' }}>
                  {formatMoneyFromCents(summary.diff_cents)}
                </strong>
              </div>
            </div>

            <button className="button" style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem', width: '100%' }} onClick={handleFinish}>
              Entendido
            </button>
          </div>
        ) : (
          <div className="stack-md">
            <label className="field">
              <span>Efectivo Real en Caja (COP)</span>
              <input
                type="number"
                min={0}
                step={50}
                placeholder="Ej. 150000"
                value={closingCashRealPesos}
                onChange={(event) => setClosingCashRealPesos(event.target.value)}
                autoFocus
              />
            </label>
            <p className="subtle-text" style={{ fontSize: '0.75rem' }}>
              Incluye la base inicial y todos los pagos recibidos en esta caja.
            </p>

            {error ? <Banner tone="error">{error}</Banner> : null}

            <div className="row-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
              <button
                className="button"
                style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem', flex: 1 }}
                onClick={() => void handleCloseSession()}
                disabled={loading || !closingCashRealPesos}
              >
                {loading ? 'Procesando...' : 'Confirmar Arqueo'}
              </button>
              <button className="ghost-button" style={{ padding: '0.75rem', flex: 1 }} onClick={onClose} disabled={loading}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
