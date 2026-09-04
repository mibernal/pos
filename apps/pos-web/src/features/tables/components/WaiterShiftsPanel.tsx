import { useState } from 'react';
import type { WaiterShiftSummary } from '@pos-dian/shared';
import { Button } from '../../../components/ui/Button';
import {
  useCloseWaiterShift,
  useOpenWaiterShift,
  useOpenWaiterShifts
} from '../api/waiter-shifts.api';

/**
 * Turnos de mesero.
 *
 * El mesero entra tecleando su PIN, que hasta ahora se guardaba y no servía para nada. Al
 * salir, el corte le dice qué vendió y cuánta propina generó, separando la que está en el
 * cajón —la que se le puede entregar hoy— de la que cobró el comercio por tarjeta.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

export function WaiterShiftsPanel({
  branchId,
  cashSessionId
}: {
  branchId: string;
  cashSessionId?: string | null;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [corte, setCorte] = useState<WaiterShiftSummary | null>(null);

  const { data: turnos, isLoading } = useOpenWaiterShifts(branchId);
  const abrir = useOpenWaiterShift();
  const cerrar = useCloseWaiterShift(branchId);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);
    try {
      await abrir.mutateAsync({ branch_id: branchId, pin, cash_session_id: cashSessionId ?? null });
      setPin('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function salir(shiftId: string) {
    setError(null);
    try {
      setCorte(await cerrar.mutateAsync(shiftId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-bold text-slate-800">Turnos abiertos</h3>
        <p className="text-slate-500 text-sm">
          El mesero entra con su PIN y sale con su corte. Su turno no es el de la caja: la caja
          abre una vez y ellos entran y salen dentro.
        </p>
      </div>

      <form onSubmit={entrar} className="flex flex-wrap gap-2 items-center">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          placeholder="PIN del mesero"
          className="border border-slate-200 rounded-lg px-3 py-2 w-44 tracking-widest font-mono"
          value={pin}
          onChange={(evento) => setPin(evento.target.value)}
        />
        <Button type="submit" disabled={pin.length < 4 || abrir.isPending}>
          {abrir.isPending ? 'Entrando…' : 'Entrar al turno'}
        </Button>
      </form>

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="h-16 bg-slate-100 rounded-xl animate-pulse" />
      ) : !turnos || turnos.length === 0 ? (
        <p className="text-sm text-slate-500">Nadie ha entrado a turno todavía.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {turnos.map((turno) => (
            <li key={turno.id} className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-slate-800">{turno.waiter_name}</p>
                <p className="text-xs text-slate-500">Desde las {hora(turno.opened_at)}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void salir(turno.id)} disabled={cerrar.isPending}>
                Cerrar turno
              </Button>
            </li>
          ))}
        </ul>
      )}

      {corte && (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
          <p className="font-semibold text-slate-800 mb-2">Corte de {corte.waiter_name}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-500">Ventas</dt>
            <dd className="text-right font-medium">
              {corte.sales_count} · {pesos(corte.sales_total_cents)}
            </dd>
            <dt className="text-slate-500">Propina en el cajón</dt>
            <dd className="text-right font-medium">{pesos(corte.tips_cash_cents)}</dd>
            <dt className="text-slate-500">Propina cobrada por el negocio</dt>
            <dd className="text-right font-medium">{pesos(corte.tips_electronic_cents)}</dd>
            <dt className="text-slate-500">Mesas atendidas</dt>
            <dd className="text-right font-medium">{corte.tables_served}</dd>
            <dt className="text-slate-500">Comensales</dt>
            <dd className="text-right font-medium">{corte.guests_served}</dd>
          </dl>
          <p className="text-xs text-slate-500 mt-3">
            La propina del cajón se le puede entregar al salir; la que cobró el negocio por
            tarjeta se paga con la nómina. Este corte queda congelado: no cambia aunque después
            se anule una venta.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setCorte(null)}>
            Cerrar
          </Button>
        </div>
      )}
    </div>
  );
}
