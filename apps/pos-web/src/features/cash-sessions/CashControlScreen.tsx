import { useState } from 'react';
import { Banner } from '../../components/ui';
import { formatMoneyFromCents } from '../../lib/format';
import type { PosApiClient } from '../../types';

export function CashControlScreen({
  api,
  _branchId,
  cashSessionId
}: {
  api: PosApiClient;
  branchId: string;
  cashSessionId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [observedCashPesos, setObservedCashPesos] = useState('');
  const [notes, setNotes] = useState('');

  const [lastAudit, setLastAudit] = useState<{
    observed_cash_cents: number;
    expected_cash_cents: number;
    diff_cents: number;
    created_at: string;
  } | null>(null);

  async function handleAudit(e: React.FormEvent) {
    e.preventDefault();
    const rawVal = Number(observedCashPesos);
    if (isNaN(rawVal) || rawVal < 0) {
      setError('Ingresa un monto válido en efectivo');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await api.auditCashSession(cashSessionId, rawVal * 100, notes);
      setSuccess('Arqueo registrado exitosamente. Ticket X disponible.');
      setLastAudit(res.audit);
      setObservedCashPesos('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar arqueo');
    } finally {
      setLoading(false);
    }
  }

  function printXReport() {
    if (!lastAudit) return;
    // In a real implementation this would generate the X report ticket
    alert('Imprimiendo Ticket X...\n' + 
      'Esperado: ' + formatMoneyFromCents(lastAudit.expected_cash_cents) + '\n' +
      'Observado: ' + formatMoneyFromCents(lastAudit.observed_cash_cents) + '\n' +
      'Diferencia: ' + formatMoneyFromCents(lastAudit.diff_cents)
    );
  }

  return (
    <div className="section-container stack-lg">
      <header className="section-heading">
        <div>
          <h2>Control de Caja</h2>
          <p>Realiza arqueos intermedios y reportes X</p>
        </div>
      </header>

      {error && <Banner tone="error">{error}</Banner>}
      {success && <Banner tone="success">{success}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <form className="detail-card stack-md" onSubmit={handleAudit}>
          <h3>Nuevo Arqueo (Reporte X)</h3>
          
          <label className="field">
            <span>Efectivo Físico en Caja (COP)</span>
            <input
              type="number"
              min={0}
              step={50}
              required
              value={observedCashPesos}
              onChange={(e) => setObservedCashPesos(e.target.value)}
              placeholder="Ej. 250000"
            />
          </label>

          <label className="field">
            <span>Notas (Opcional)</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Explicación en caso de faltantes o sobrantes..."
              style={{ padding: '0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-slate-200)', fontFamily: 'inherit' }}
            />
          </label>

          <button
            type="submit"
            className="button"
            disabled={loading || !observedCashPesos}
            style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem' }}
          >
            {loading ? 'Procesando...' : 'Registrar Arqueo'}
          </button>
        </form>

        <div className="detail-card stack-md">
          <h3>Último Arqueo</h3>
          {lastAudit ? (
            <div className="stack-md">
              <div className="detail-item-row">
                <span>Fecha y Hora</span>
                <strong>{new Date(lastAudit.created_at).toLocaleString()}</strong>
              </div>
              <div className="detail-item-row">
                <span>Efectivo Esperado</span>
                <strong>{formatMoneyFromCents(lastAudit.expected_cash_cents)}</strong>
              </div>
              <div className="detail-item-row">
                <span>Efectivo Físico</span>
                <strong>{formatMoneyFromCents(lastAudit.observed_cash_cents)}</strong>
              </div>
              <div className="detail-item-row">
                <span>Diferencia</span>
                <strong style={{ color: lastAudit.diff_cents < 0 ? 'var(--color-error-600)' : lastAudit.diff_cents > 0 ? 'var(--color-success-600)' : 'inherit' }}>
                  {formatMoneyFromCents(lastAudit.diff_cents)}
                </strong>
              </div>
              
              <button
                type="button"
                className="button button-outline"
                onClick={printXReport}
                style={{ width: '100%', marginTop: '1rem' }}
              >
                🖨️ Imprimir Ticket X
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-slate-500)' }}>
              <p>No se han realizado arqueos en esta sesión.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
