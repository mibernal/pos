import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Banner } from '../../../components/ui';
import type { ApiClient } from '../../../lib/api/client';
import {
  PAYMENT_KINDS,
  PAYMENT_KIND_BEHAVIOR,
  PAYMENT_GROUP_LABELS,
  type PaymentKind,
  type PaymentMethodCatalogEntry
} from '@pos-dian/shared';

/**
 * Medios de pago del comercio.
 *
 * Lo que se configura es el nombre y si está encendido. El **comportamiento** —si toca el
 * cajón, si trae dinero hoy— viene del tipo y no se puede tocar: un comercio puede llamar a
 * su medio como quiera, pero no declarar que un fiado entra en efectivo.
 */
export function PaymentMethodsPanel({ api }: { api: ApiClient }) {
  const [methods, setMethods] = useState<PaymentMethodCatalogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ code: '', label: '', kind: 'WALLET' as PaymentKind });

  const cargar = useCallback(async () => {
    try {
      setLoading(true);
      setMethods((await api.getPaymentMethods()).payment_methods);
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

  async function alternar(method: PaymentMethodCatalogEntry) {
    try {
      await api.upsertPaymentMethod(method.code, {
        kind: method.kind,
        label: method.label,
        active: !method.active,
        requires_reference: method.requires_reference,
        sort_order: method.sort_order
      });
      await cargar();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function crear(evento: React.FormEvent) {
    evento.preventDefault();
    setCreando(true);
    setError(null);
    try {
      await api.upsertPaymentMethod(nuevo.code.toUpperCase(), {
        kind: nuevo.kind,
        label: nuevo.label,
        active: true,
        sort_order: 200
      });
      setNuevo({ code: '', label: '', kind: 'WALLET' });
      await cargar();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreando(false);
    }
  }

  if (loading && methods.length === 0) {
    return <div className="h-64 bg-muted/50 rounded-2xl animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="error">{error}</Banner>}

      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-1">Medios de pago</h3>
        <p className="text-sm text-muted-foreground mb-5">
          Los que estén encendidos aparecen en la pantalla de cobro y como línea propia en el cierre de caja.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-semibold">Medio</th>
                <th className="text-left py-2 font-semibold">Efecto en el turno</th>
                <th className="text-left py-2 font-semibold">Referencia</th>
                <th className="text-right py-2 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((method) => {
                const behavior = PAYMENT_KIND_BEHAVIOR[method.kind];

                return (
                  <tr key={method.code} className="border-b border-border/50 last:border-0">
                    <td className="py-3">
                      <span className="font-medium text-foreground">{method.label}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{method.code}</span>
                    </td>
                    <td className="py-3 text-muted-foreground">{PAYMENT_GROUP_LABELS[behavior.group]}</td>
                    <td className="py-3 text-muted-foreground">
                      {method.requires_reference ? 'Obligatoria' : 'Opcional'}
                    </td>
                    <td className="py-3 text-right">
                      <Button variant={method.active ? 'default' : 'outline'} size="sm" onClick={() => alternar(method)}>
                        {method.active ? 'Encendido' : 'Apagado'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-bold text-foreground mb-1">Añadir un medio</h3>
        <p className="text-sm text-muted-foreground mb-4">
          El tipo decide qué le hace el dinero al turno y no se puede cambiar después: si te equivocas, crea otro y
          apaga este.
        </p>

        <form onSubmit={crear} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Código</span>
            <input
              value={nuevo.code}
              onChange={(evento) => setNuevo({ ...nuevo, code: evento.target.value.toUpperCase() })}
              placeholder="NEQUI"
              required
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground font-mono"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Nombre</span>
            <input
              value={nuevo.label}
              onChange={(evento) => setNuevo({ ...nuevo, label: evento.target.value })}
              placeholder="Nequi"
              required
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">Tipo</span>
            <select
              value={nuevo.kind}
              onChange={(evento) => setNuevo({ ...nuevo, kind: evento.target.value as PaymentKind })}
              className="px-3 py-2 rounded-lg border border-border bg-background text-foreground"
            >
              {PAYMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PAYMENT_KIND_BEHAVIOR[kind].label} · {PAYMENT_GROUP_LABELS[PAYMENT_KIND_BEHAVIOR[kind].group]}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" disabled={creando || !nuevo.code || !nuevo.label}>
            {creando ? 'Guardando…' : 'Añadir'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
