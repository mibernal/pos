import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Banner } from '../../../components/ui';
import { RECEIVABLE_STATUS_LABELS } from '@pos-dian/shared';
import { useApi, useSession } from '../../auth';
import { customerKeys } from '../../../shared/query-keys';

/**
 * Cartera del comercio: quién debe, cuánto y desde cuándo.
 *
 * Es la pantalla que sustituye al cuaderno. Lo vencido va primero y marcado, porque es lo
 * único accionable: el resto es información, esto es una llamada por hacer.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    cents / 100
  );
}

function fecha(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-CO') : '—';
}

function mensajeDeError(causa: unknown): string | null {
  if (!causa) {
    return null;
  }

  return causa instanceof Error ? causa.message : String(causa);
}

export function ReceivablesPanel({ branchId,
  cashSessionId
}: {
  branchId: string;
  cashSessionId?: string | null;
}) {
  const api = useApi();
  const { tenantId } = useSession();
  const queryClient = useQueryClient();
  const [clienteAbierto, setClienteAbierto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abono, setAbono] = useState('');

  const consultaCartera = useQuery({
    queryKey: customerKeys.receivables(tenantId),
    queryFn: () => api.getReceivables()
  });

  const consultaEstado = useQuery({
    queryKey: customerKeys.statement(tenantId, clienteAbierto ?? ''),
    queryFn: () => api.getCustomerStatement(clienteAbierto!),
    enabled: Boolean(clienteAbierto)
  });

  const registrarPago = useMutation({
    mutationFn: ({ customerId, centavos }: { customerId: string; centavos: number }) =>
      api.registerReceivablePayment(customerId, {
        amount_cents: centavos,
        method: 'CASH',
        method_code: 'CASH',
        branch_id: branchId,
        ...(cashSessionId ? { cash_session_id: cashSessionId } : {})
      }),
    onSuccess: async (_resultado, { customerId }) => {
      setAbono('');
      setAviso('Abono registrado. Entra al turno de caja como efectivo.');
      // El abono mueve dos cifras a la vez: el saldo de este cliente y el total de la
      // cartera. Refrescar solo el extracto dejaría el encabezado cobrando de más.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: customerKeys.receivables(tenantId) }),
        queryClient.invalidateQueries({ queryKey: customerKeys.statement(tenantId, customerId) })
      ]);
    }
  });

  const cartera = consultaCartera.data ?? null;
  const statement = consultaEstado.data ?? null;
  const error =
    mensajeDeError(registrarPago.error) ??
    mensajeDeError(consultaEstado.error) ??
    mensajeDeError(consultaCartera.error);

  function abrir(customerId: string) {
    setAviso(null);
    setClienteAbierto(customerId);
  }

  function registrarAbono(evento: React.FormEvent) {
    evento.preventDefault();
    if (!statement) return;

    const centavos = Math.round(Number(abono.replace(/[^\d]/g, '')) * 100);
    if (!centavos) return;

    registrarPago.mutate({ customerId: statement.account.customer_id, centavos });
  }

  if (!cartera) return <div className="h-48 bg-muted/50 rounded-2xl animate-pulse" />;

  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="error">{error}</Banner>}
      {aviso && <Banner tone="info">{aviso}</Banner>}

      <Card className="p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-lg font-bold text-foreground">Cartera</h3>
          <span className="text-xl font-extrabold text-foreground tabular-nums">{pesos(cartera.total_cents)}</span>
        </div>

        {cartera.customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nadie tiene saldo pendiente.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {cartera.customers.map((cliente) => (
              <button
                key={cliente.customer_id}
                onClick={() => abrir(cliente.customer_id)}
                className={`flex items-center justify-between gap-4 p-3 rounded-xl border text-left transition-colors ${
                  cliente.overdue
                    ? 'border-amber-300 bg-amber-50 hover:bg-amber-100'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div>
                  <p className="font-medium text-foreground">{cliente.customer_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {cliente.documents} {cliente.documents === 1 ? 'documento' : 'documentos'}
                    {cliente.overdue ? ` · vencido desde el ${fecha(cliente.oldest_due_at)}` : ''}
                  </p>
                </div>
                <span className="font-semibold tabular-nums text-foreground">{pesos(cliente.balance_cents)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {statement && (
        <Card className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <h3 className="text-lg font-bold text-foreground">{statement.account.customer_name}</h3>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Saldo</p>
              <p className="text-xl font-extrabold text-foreground tabular-nums">
                {pesos(statement.account.balance_cents)}
              </p>
              <p className="text-xs text-muted-foreground">
                {statement.account.available_cents === null
                  ? 'Sin límite de cupo'
                  : `Cupo disponible ${pesos(statement.account.available_cents)}`}
              </p>
            </div>
          </div>

          {!cashSessionId && (
            <Banner tone="warning">
              Abre un turno de caja para recibir abonos en efectivo: si no, el dinero entraría al cajón sin quedar
              registrado en ningún arqueo.
            </Banner>
          )}

          <form onSubmit={registrarAbono} className="flex flex-wrap gap-2 my-4">
            <input
              value={abono}
              onChange={(evento) => setAbono(evento.target.value)}
              inputMode="numeric"
              placeholder="Abono en efectivo"
              className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-border bg-background text-foreground"
            />
            <Button type="submit" disabled={!abono.trim() || !cashSessionId}>
              Registrar abono
            </Button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-semibold">Venta</th>
                  <th className="text-left py-2 font-semibold">Vence</th>
                  <th className="text-right py-2 font-semibold">Original</th>
                  <th className="text-right py-2 font-semibold">Saldo</th>
                  <th className="text-left py-2 pl-4 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {statement.receivables.map((documento) => (
                  <tr key={documento.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 font-mono text-xs">
                      {documento.sale_number ? `#${documento.sale_number}` : '—'}
                    </td>
                    <td className={`py-2 ${documento.overdue ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
                      {fecha(documento.due_at)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{pesos(documento.original_cents)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold">{pesos(documento.balance_cents)}</td>
                    <td className="py-2 pl-4 text-muted-foreground">{RECEIVABLE_STATUS_LABELS[documento.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
