import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Banner } from '../../../components/ui';
import type { BillingPortal } from '@pos-dian/shared';
import { INVOICE_STATUS_LABELS, DUNNING_STEP_LABELS, UNLIMITED } from '@pos-dian/shared';
import { PaymentMethodForm } from './PaymentMethodForm';
import { useApi } from '../../auth';

/**
 * El estado de cuenta del comercio.
 *
 * Responde sin escribir a soporte las cuatro preguntas que llegaban por ahí: cuánto me van
 * a cobrar y cuándo, con qué tarjeta, cuánto de mi plan estoy usando, y dónde está la
 * factura del mes pasado.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function fecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

const ESTADO_SUSCRIPCION: Record<string, { texto: string; clase: string }> = {
  TRIAL: { texto: 'En prueba', clase: 'bg-blue-100 text-blue-800' },
  ACTIVE: { texto: 'Al día', clase: 'bg-green-100 text-green-800' },
  PAST_DUE: { texto: 'Pago pendiente', clase: 'bg-amber-100 text-amber-800' },
  SUSPENDED: { texto: 'Suspendida', clase: 'bg-red-100 text-red-800' },
  CANCELLED: { texto: 'Cancelada', clase: 'bg-gray-200 text-gray-700' }
};

export function AccountPanel() {
  const api = useApi();
  const [portal, setPortal] = useState<BillingPortal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [cupon, setCupon] = useState('');

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      setPortal(await api.getBillingPortal());
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cobrarAhora() {
    setCobrando(true);
    setAviso(null);
    try {
      const resultado = await api.payNow();
      setAviso(
        resultado.outcome === 'charged'
          ? 'Listo, el cobro se aprobó y tu cuenta quedó al día.'
          : resultado.outcome === 'pending'
            ? 'La pasarela está procesando el cobro. Te avisamos por correo en cuanto se confirme.'
            : `No se pudo cobrar: ${resultado.detail ?? 'la pasarela rechazó el cobro'}`
      );
      await cargar();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : String(err));
    } finally {
      setCobrando(false);
    }
  }

  async function aplicarCupon(evento: React.FormEvent) {
    evento.preventDefault();
    if (!cupon.trim()) return;
    try {
      await api.redeemCoupon(cupon.trim().toUpperCase());
      setCupon('');
      setAviso('Cupón aplicado. El descuento entra en tu próxima factura.');
      await cargar();
    } catch (err: unknown) {
      setAviso(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading && !portal) {
    return (
      <div className="grid gap-6">
        <div className="h-40 bg-muted/50 rounded-2xl animate-pulse" />
        <div className="h-64 bg-muted/50 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!portal) return null;

  const { subscription, usage, payment_method: metodo, invoices, dunning } = portal;
  const estado = ESTADO_SUSCRIPCION[subscription.status] ?? {
    texto: subscription.status,
    clase: 'bg-gray-200 text-gray-700'
  };
  const enMora = subscription.status === 'PAST_DUE' || subscription.status === 'SUSPENDED';
  const facturaAbierta = invoices.find((factura) => factura.status === 'OPEN');

  return (
    <div className="flex flex-col gap-6">
      {aviso && <Banner tone="info">{aviso}</Banner>}

      {/**
       * Cuando hay mora, lo primero que se ve es qué pasa y qué hacer. El estado de una
       * cuenta que va a suspenderse no puede estar tres tarjetas más abajo.
       */}
      {enMora && (
        <Banner tone="error">
          <div className="flex flex-col gap-2">
            <strong>
              {subscription.status === 'SUSPENDED'
                ? 'Tu cuenta está suspendida por falta de pago.'
                : 'No pudimos cobrar tu última renovación.'}
            </strong>
            <span className="text-sm">
              {subscription.status === 'SUSPENDED'
                ? 'Tu información está intacta. Con un pago se reactiva todo donde lo dejaste.'
                : `Tu punto de venta sigue funcionando. Los informes y la configuración vuelven en cuanto se resuelva el pago${
                    subscription.next_retry_at ? `; el siguiente intento es el ${fecha(subscription.next_retry_at)}` : ''
                  }.`}
            </span>
            {facturaAbierta && metodo && (
              <div>
                <Button onClick={cobrarAhora} disabled={cobrando} size="sm">
                  {cobrando ? 'Cobrando…' : `Pagar ${pesos(facturaAbierta.total_cents)} ahora`}
                </Button>
              </div>
            )}
          </div>
        </Banner>
      )}

      {/* Plan y próximo cobro */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-bold text-foreground">{subscription.plan_name}</h2>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${estado.clase}`}>
                {estado.texto}
              </span>
            </div>
            <p className="text-muted-foreground">
              {pesos(subscription.price_cents)} {subscription.billing_cycle === 'YEARLY' ? 'al año' : 'al mes'}
              {subscription.coupon_code && (
                <span className="ml-2 text-primary font-medium">· cupón {subscription.coupon_code}</span>
              )}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              {subscription.status === 'TRIAL' ? 'La prueba termina' : 'Próximo cobro'}
            </p>
            <p className="text-lg font-semibold text-foreground">
              {fecha(subscription.status === 'TRIAL' ? subscription.trial_ends_at : subscription.next_billing_at)}
            </p>
            {!subscription.auto_renew && (
              <p className="text-xs text-amber-600 font-medium mt-1">Renovación automática apagada</p>
            )}
          </div>
        </div>
      </Card>

      {/* Consumo contra los límites del plan */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Uso de tu plan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {usage.map((fila) => {
            const ilimitado = fila.limit === UNLIMITED;
            const porcentaje = ilimitado ? 0 : Math.min(100, Math.round((fila.used / Math.max(1, fila.limit)) * 100));
            const apretado = !ilimitado && porcentaje >= 80;

            return (
              <div key={fila.key} className="border border-border rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">{fila.label}</span>
                  <span className={`text-sm font-semibold ${apretado ? 'text-amber-600' : 'text-muted-foreground'}`}>
                    {fila.used}
                    {ilimitado ? '' : ` / ${fila.limit}`}
                  </span>
                </div>
                {ilimitado ? (
                  <p className="text-xs text-muted-foreground">Sin límite en tu plan</p>
                ) : (
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${apretado ? 'bg-amber-500' : 'bg-primary'}`}
                      style={{ width: `${porcentaje}%` }}
                    />
                  </div>
                )}
                {!fila.enforced && (
                  // `monthly_sales` se mide pero no se bloquea: cortar la facturación de un
                  // comercio a mitad de servicio no es decisión de un límite comercial.
                  <p className="text-xs text-muted-foreground mt-2">Solo informativo</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Medio de pago */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Medio de pago</h3>
        <PaymentMethodForm metodo={metodo} onCambio={cargar} />
      </Card>

      {/* Cupón */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-1">¿Tienes un cupón?</h3>
        <p className="text-sm text-muted-foreground mb-4">El descuento se aplica desde tu próxima factura.</p>
        <form onSubmit={aplicarCupon} className="flex gap-2 max-w-md">
          <input
            value={cupon}
            onChange={(evento) => setCupon(evento.target.value.toUpperCase())}
            placeholder="CODIGO"
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono tracking-wider"
          />
          <Button type="submit" variant="outline" disabled={!cupon.trim()}>
            Aplicar
          </Button>
        </form>
      </Card>

      {/* Facturas */}
      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Facturas</h3>
        {invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay facturas emitidas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left py-2 font-semibold">Número</th>
                  <th className="text-left py-2 font-semibold">Periodo</th>
                  <th className="text-right py-2 font-semibold">Total</th>
                  <th className="text-left py-2 pl-4 font-semibold">Estado</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((factura) => (
                  <tr key={factura.id} className="border-b border-border/50 last:border-0">
                    <td className="py-3 font-mono text-xs">{factura.number}</td>
                    <td className="py-3 text-muted-foreground">
                      {new Date(factura.period_start).toLocaleDateString('es-CO')} —{' '}
                      {new Date(factura.period_end).toLocaleDateString('es-CO')}
                    </td>
                    <td className="py-3 text-right font-semibold">{pesos(factura.total_cents)}</td>
                    <td className="py-3 pl-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          factura.status === 'PAID'
                            ? 'bg-green-100 text-green-800'
                            : factura.status === 'OPEN'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {INVOICE_STATUS_LABELS[factura.status]}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <a
                        href={api.invoiceUrl(factura.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline text-xs font-semibold"
                      >
                        Ver
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/**
       * El rastro de la cobranza, para el comercio. Que pueda leer «se intentó cobrar el
       * 15, se rechazó, se volvió a intentar el 16» evita la llamada en la que hay que
       * explicárselo.
       */}
      {dunning.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-bold text-foreground mb-4">Historial de cobros</h3>
          <ol className="flex flex-col gap-3">
            {dunning.map((evento) => (
              <li key={evento.id} className="flex gap-3 text-sm">
                <span className="text-muted-foreground whitespace-nowrap tabular-nums">
                  {new Date(evento.occurred_at).toLocaleDateString('es-CO')}
                </span>
                <span className="font-medium text-foreground">{DUNNING_STEP_LABELS[evento.step]}</span>
                {evento.detail && <span className="text-muted-foreground">· {evento.detail}</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
