import { useState } from 'react';
import { Banner, Modal } from '../../../components/ui';
import { useApi } from '../../auth';

export function CashMovementModal({
  isOpen,
  sessionId,
  onClose,
  onSuccess
}: {
  isOpen: boolean;
  sessionId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const api = useApi();
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amountPesos, setAmountPesos] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(Number(amountPesos) * 100);
    if (amountCents <= 0) {
      setError('Ingresa un monto válido mayor a 0');
      return;
    }
    if (reason.trim().length < 3) {
      setError('El motivo debe tener al menos 3 caracteres');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.addCashMovement(sessionId, type, amountCents, reason);
      setAmountPesos('');
      setReason('');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible registrar el movimiento');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal ariaLabel="Movimiento de Caja" onClose={onClose}>
      <form onSubmit={handleSubmit} className="stack-md">
        <div className="section-heading">
          <div>
            <h3>Movimiento de Caja Menor</h3>
            <p>Registra ingresos (bases) o egresos (pagos a proveedores).</p>
          </div>
        </div>

        <div className="grid-2">
          <label className="field">
            <span>Tipo de Movimiento</span>
            <select value={type} onChange={(e) => setType(e.target.value as 'IN' | 'OUT')} required>
              <option value="OUT">Egreso (Salida de dinero)</option>
              <option value="IN">Ingreso (Entrada de dinero)</option>
            </select>
          </label>
          <label className="field">
            <span>Monto (COP)</span>
            <input
              type="number"
              min="50"
              step="50"
              placeholder="Ej. 50000"
              value={amountPesos}
              onChange={(e) => setAmountPesos(e.target.value)}
              required
              autoFocus
            />
          </label>
        </div>

        <label className="field">
          <span>Motivo / Concepto</span>
          <input
            type="text"
            placeholder="Ej. Pago transporte local"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>

        {error && <Banner tone="error">{error}</Banner>}

        <div className="row-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            className="button"
            style={{ background: 'var(--color-primary-600)', color: '#fff', padding: '0.75rem', flex: 1 }}
            disabled={loading || !amountPesos || !reason}
          >
            {loading ? 'Guardando...' : 'Registrar Movimiento'}
          </button>
          <button type="button" className="ghost-button" style={{ padding: '0.75rem', flex: 1 }} onClick={onClose} disabled={loading}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  );
}
