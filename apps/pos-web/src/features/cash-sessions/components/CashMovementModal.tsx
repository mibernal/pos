import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner, Modal } from '../../../components/ui';
import { useApi } from '../../auth';
import { usePosStore } from '../../../hooks/usePosStore';
import { cashKeys } from '../../../shared/query-keys';

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
  const queryClient = useQueryClient();

  /**
   * La terminal no llega por props —este modal solo recibe la sesión—, pero es ella la que
   * manda en la clave de la sesión de caja. Sale del mismo contexto POS con el que el
   * armazón decide pintar este modal, así que cuando se ve en pantalla siempre está.
   */
  const terminalId = usePosStore((estado) => estado.posContext?.terminalId ?? null);

  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amountPesos, setAmountPesos] = useState('');
  const [reason, setReason] = useState('');
  // Monto y motivo se validan antes de salir a la red: ese error no es el de la mutación.
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  const registrar = useMutation({
    mutationFn: (amountCents: number) => api.addCashMovement(sessionId, type, amountCents, reason),
    onSuccess: () => {
      setAmountPesos('');
      setReason('');
      /**
       * Un movimiento mueve el efectivo esperado de la sesión, así que lo que haya en caché
       * ya no cuadra. Se invalida sin esperar: si la recarga se atascara, esperarla dejaría
       * el modal abierto sobre un movimiento YA registrado, y el cajero volvería a
       * registrarlo. Un apunte duplicado es peor que una cifra que tarda un segundo.
       */
      void queryClient.invalidateQueries({ queryKey: cashKeys.currentSession(terminalId) });
      onSuccess();
    }
  });

  const loading = registrar.isPending;
  const error =
    errorValidacion ??
    (registrar.error
      ? (registrar.error instanceof Error ? registrar.error.message : 'No fue posible registrar el movimiento')
      : null);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(Number(amountPesos) * 100);
    if (amountCents <= 0) {
      setErrorValidacion('Ingresa un monto válido mayor a 0');
      return;
    }
    if (reason.trim().length < 3) {
      setErrorValidacion('El motivo debe tener al menos 3 caracteres');
      return;
    }

    setErrorValidacion(null);
    registrar.mutate(amountCents);
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
