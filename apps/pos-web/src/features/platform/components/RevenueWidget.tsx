import { useEffect, useState } from 'react';
import { Card, Banner } from '../../../components/ui';
import type { RevenueMetrics } from '@pos-dian/shared';
import { useApi } from '../../auth';

/**
 * Panel de ingresos.
 *
 * El resumen ejecutivo ya mostraba un MRR, pero solo podía hablar de lo que *debería*
 * entrar: precios de plan por suscripciones activas. Lo efectivamente cobrado no existía en
 * ninguna parte porque no había facturas. Con la fase 8 sí, y la diferencia entre las dos
 * cifras —cobrado contra facturado— es justo el número que dice si la cobranza funciona.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
    notation: cents >= 100_000_000 ? 'compact' : 'standard'
  }).format(cents / 100);
}

function Cifra({
  etiqueta,
  valor,
  detalle,
  tono = 'neutro'
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  tono?: 'neutro' | 'bueno' | 'atencion';
}) {
  const color =
    tono === 'bueno' ? 'text-green-600' : tono === 'atencion' ? 'text-amber-600' : 'text-foreground';

  return (
    <div className="border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">{etiqueta}</p>
      <p className={`text-2xl font-extrabold tracking-tight ${color}`}>{valor}</p>
      {detalle && <p className="text-xs text-muted-foreground mt-1">{detalle}</p>}
    </div>
  );
}

export function RevenueWidget() {
  const api = useApi();
  const [metrics, setMetrics] = useState<RevenueMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getRevenueMetrics()
      .then((respuesta) => setMetrics(respuesta.metrics))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [api]);

  if (error) return <Banner tone="error">{error}</Banner>;

  if (!metrics) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 bg-muted/50 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const facturado = metrics.collected_last_30d_cents + metrics.failed_last_30d_cents;
  const tasaCobro = facturado > 0 ? Math.round((metrics.collected_last_30d_cents / facturado) * 100) : 100;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Cifra
          etiqueta="MRR"
          valor={pesos(metrics.mrr_cents)}
          detalle={`${metrics.active_subscriptions} suscripciones activas`}
        />
        <Cifra etiqueta="ARR" valor={pesos(metrics.arr_cents)} detalle="Proyección a doce meses" />
        <Cifra
          etiqueta="Ingreso por cuenta"
          valor={pesos(metrics.arpa_cents)}
          detalle="Promedio mensual por comercio activo"
        />
        <Cifra
          etiqueta="Churn (30 días)"
          valor={`${(metrics.churn_rate * 100).toFixed(1)} %`}
          detalle={`${metrics.churned_last_30d} bajas · ${metrics.new_last_30d} altas`}
          tono={metrics.churn_rate > 0.05 ? 'atencion' : 'neutro'}
        />
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-1">Cobranza de los últimos 30 días</h3>
        <p className="text-sm text-muted-foreground mb-5">
          Lo que se facturó frente a lo que efectivamente entró. La diferencia es lo que la secuencia de cobranza
          todavía está persiguiendo.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Cifra etiqueta="Cobrado" valor={pesos(metrics.collected_last_30d_cents)} tono="bueno" />
          <Cifra
            etiqueta="Sin cobrar"
            valor={pesos(metrics.failed_last_30d_cents)}
            tono={metrics.failed_last_30d_cents > 0 ? 'atencion' : 'neutro'}
            detalle={`${metrics.past_due_subscriptions} cuentas en mora`}
          />
          <Cifra
            etiqueta="Tasa de cobro"
            valor={`${tasaCobro} %`}
            tono={tasaCobro >= 95 ? 'bueno' : 'atencion'}
            detalle={`${metrics.trial_subscriptions} en periodo de prueba`}
          />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-4">Ingreso por plan</h3>
        {metrics.by_plan.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay suscripciones activas.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {metrics.by_plan.map((fila) => {
              const parte = metrics.mrr_cents > 0 ? Math.round((fila.mrr_cents / metrics.mrr_cents) * 100) : 0;

              return (
                <div key={fila.plan_id}>
                  <div className="flex items-baseline justify-between mb-1 text-sm">
                    <span className="font-medium text-foreground">
                      {fila.plan_name}
                      <span className="text-muted-foreground font-normal"> · {fila.subscriptions} comercios</span>
                    </span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {pesos(fila.mrr_cents)} <span className="text-muted-foreground font-normal">({parte} %)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${parte}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
