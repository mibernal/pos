import { useCallback, useEffect, useState } from 'react';
import { Banner } from '../../components/ui';
import { MENU_CLASS_LABELS, type MenuEngineeringRow, type PrepTimeRow, type SalesByHourRow, type TableTurnoverRow } from '@pos-dian/shared';
import { useApi } from '../auth';

/**
 * Operación del restaurante.
 *
 * Cuatro preguntas de encargado: cuánto tarda una mesa en girar, cuánto tarda la cocina, a
 * qué horas se vende y qué platos merecen estar en la carta.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

const CLASE_COLOR: Record<string, string> = {
  ESTRELLA: 'bg-green-100 text-green-800',
  VACA: 'bg-blue-100 text-blue-800',
  ENIGMA: 'bg-amber-100 text-amber-800',
  PERRO: 'bg-red-100 text-red-800'
};

export function OperationsTab({
  branchId,
  from,
  to
}: {
  branchId: string;
  from: string;
  to: string;
}) {
  const api = useApi();
  const [mesas, setMesas] = useState<TableTurnoverRow[]>([]);
  const [cocina, setCocina] = useState<PrepTimeRow[]>([]);
  const [franjas, setFranjas] = useState<SalesByHourRow[]>([]);
  const [carta, setCarta] = useState<MenuEngineeringRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!branchId || !from || !to) return;
    setCargando(true);
    setError(null);
    try {
      const [t, p, s, m] = await Promise.all([
        api.getTableTurnover({ branch_id: branchId, from, to }),
        api.getPrepTime({ branch_id: branchId, from, to }),
        api.getSalesByHour({ branch_id: branchId, from, to }),
        api.getMenuEngineering({ branch_id: branchId, from, to })
      ]);
      setMesas(t);
      setCocina(p);
      setFranjas(s);
      setCarta(m);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, [api, branchId, from, to]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (cargando) return <div className="h-64 bg-muted/50 rounded-2xl animate-pulse" />;

  const maximo = Math.max(1, ...franjas.map((franja) => franja.total_cents));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-foreground mb-1">Rotación de mesa</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Desde que se abre la cuenta hasta que se cobra.
        </p>
        {mesas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin servicios en el periodo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Mesa</th>
                <th className="py-1 text-center">Servicios</th>
                <th className="py-1 text-right">Minutos</th>
                <th className="py-1 text-right">Ticket medio</th>
              </tr>
            </thead>
            <tbody>
              {mesas.map((mesa) => (
                <tr key={mesa.table_id} className="border-t border-border">
                  <td className="py-1.5 font-medium text-foreground">{mesa.table_name}</td>
                  <td className="py-1.5 text-center">{mesa.services}</td>
                  <td className="py-1.5 text-right">{mesa.avg_minutes}</td>
                  <td className="py-1.5 text-right">{pesos(mesa.avg_ticket_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-foreground mb-1">Tiempo de cocina</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Desde que entra la comanda hasta que la estación la da por lista. El p90 es la cola:
          la media la esconde y la cola es la que enfada al cliente.
        </p>
        {cocina.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin comandas terminadas en el periodo. El dato empieza a acumularse desde que la
            cocina marca los tickets como listos.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Estación</th>
                <th className="py-1 text-center">Comandas</th>
                <th className="py-1 text-right">Media</th>
                <th className="py-1 text-right">p90</th>
              </tr>
            </thead>
            <tbody>
              {cocina.map((estacion) => (
                <tr key={estacion.station} className="border-t border-border">
                  <td className="py-1.5 font-medium text-foreground">{estacion.station}</td>
                  <td className="py-1.5 text-center">{estacion.tickets}</td>
                  <td className="py-1.5 text-right">{estacion.avg_minutes} min</td>
                  <td className="py-1.5 text-right">{estacion.p90_minutes} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-foreground mb-1">Ventas por franja</h3>
        <p className="text-xs text-muted-foreground mb-4">A qué horas hace falta gente.</p>
        {franjas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el periodo.</p>
        ) : (
          <ul className="space-y-1">
            {franjas.map((franja) => (
              <li key={franja.hour} className="flex items-center gap-2 text-sm">
                <span className="w-12 tabular-nums text-muted-foreground">
                  {String(franja.hour).padStart(2, '0')}:00
                </span>
                <span className="flex-1 bg-muted rounded h-4 overflow-hidden">
                  <span
                    className="block h-full bg-primary/70"
                    style={{ width: `${Math.round((franja.total_cents / maximo) * 100)}%` }}
                  />
                </span>
                <span className="w-28 text-right tabular-nums">{pesos(franja.total_cents)}</span>
                <span className="w-10 text-right text-muted-foreground tabular-nums">{franja.sales_count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm">
        <h3 className="font-bold text-foreground mb-1">La carta</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Lo que se vende cruzado con lo que deja. Un plato sin receta sale sin clasificar: sin
          escandallo no hay margen que calcular.
        </p>
        {carta.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el periodo.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">Plato</th>
                <th className="py-1 text-center">Vendidos</th>
                <th className="py-1 text-right">Margen</th>
                <th className="py-1">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {carta.map((plato) => (
                <tr key={plato.product_id} className="border-t border-border">
                  <td className="py-1.5 font-medium text-foreground">{plato.product_name}</td>
                  <td className="py-1.5 text-center">{plato.qty_sold}</td>
                  <td className="py-1.5 text-right">
                    {plato.margin_percent === null ? '—' : `${plato.margin_percent}%`}
                  </td>
                  <td className="py-1.5">
                    {plato.classification && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${CLASE_COLOR[plato.classification] ?? ''}`}
                        title={MENU_CLASS_LABELS[plato.classification]}
                      >
                        {MENU_CLASS_LABELS[plato.classification].split('—')[0]?.trim()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
