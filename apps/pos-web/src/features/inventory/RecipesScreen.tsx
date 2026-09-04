import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card } from '../../components/ui';
import type { ApiClient, RecipeSummary } from '../../lib/api/client';
import type { ConsumptionDeviationRow, ProductItem, Recipe } from '@pos-dian/shared';

/**
 * Recetas y escandallo.
 *
 * Dos preguntas, una pantalla: cuánto cuesta de verdad este plato, y por qué se está yendo
 * más producto del que las recetas explican. La primera fija la carta; la segunda encuentra
 * la fuga, y es la que no se puede responder sin haber configurado la primera.
 */

function pesos(cents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function hoyLocal(desplazamientoDias = 0): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + desplazamientoDias);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

interface ComponenteEditable {
  ingredient_product_id: string;
  qty: string;
  waste_percent: string;
}

export function RecipesScreen({ api, branchId }: { api: ApiClient; branchId?: string }) {
  const [pestana, setPestana] = useState<'escandallo' | 'desviacion'>('escandallo');

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Recetas</h1>
        <p className="text-muted-foreground">
          Qué lleva cada plato: cuánto cuesta de verdad y cuánto inventario baja al venderlo.
        </p>
      </header>

      <div className="flex gap-2 mb-6">
        <Button
          variant={pestana === 'escandallo' ? 'default' : 'outline'}
          onClick={() => setPestana('escandallo')}
        >
          Escandallo
        </Button>
        <Button
          variant={pestana === 'desviacion' ? 'default' : 'outline'}
          onClick={() => setPestana('desviacion')}
        >
          Desviación
        </Button>
      </div>

      {pestana === 'escandallo' ? (
        <EscandalloPanel api={api} />
      ) : (
        <DesviacionPanel api={api} branchId={branchId} />
      )}
    </div>
  );
}

function EscandalloPanel({ api }: { api: ApiClient }) {
  const [recetas, setRecetas] = useState<RecipeSummary[]>([]);
  const [productos, setProductos] = useState<ProductItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<{ productId: string; receta: Recipe | null } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      const [lista, catalogo] = await Promise.all([api.getRecipes(), api.listProducts({ limit: 500 })]);
      setRecetas(lista);
      setProductos(catalogo.items);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, [api]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function abrir(productId: string) {
    setError(null);
    try {
      setEditando({ productId, receta: await api.getRecipe(productId) });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (cargando && recetas.length === 0) {
    return <div className="h-64 bg-muted/50 rounded-2xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      {error && <Banner tone="error">{error}</Banner>}

      {editando ? (
        <EditorReceta
          api={api}
          productos={productos}
          productId={editando.productId}
          receta={editando.receta}
          onCerrar={() => setEditando(null)}
          onGuardado={async (guardada) => {
            // No se cierra: guardar es justamente cuando aparece el costo teórico y el
            // margen de verdad, que es lo que se estaba buscando al abrir la receta.
            setEditando({ productId: guardada.product_id, receta: guardada });
            await cargar();
          }}
          onEliminado={async () => {
            setEditando(null);
            await cargar();
          }}
          onError={setError}
        />
      ) : (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-bold text-foreground">Platos con receta</h2>
            <select
              className="border border-border rounded-lg px-3 py-2 bg-background text-sm"
              value=""
              onChange={(evento) => evento.target.value && void abrir(evento.target.value)}
            >
              <option value="">Añadir receta a un producto…</option>
              {productos.map((producto) => (
                <option key={producto.id} value={producto.id}>
                  {producto.name}
                </option>
              ))}
            </select>
          </div>

          {recetas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay recetas. Sin ellas, vender un plato descuenta el plato: el pan y la
              carne se consumen sin que el inventario se entere.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2">Plato</th>
                    <th className="py-2 text-center">Ingredientes</th>
                    <th className="py-2 text-right">Precio</th>
                    <th className="py-2 text-right">Costo teórico</th>
                    <th className="py-2 text-right">Margen</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {recetas.map((receta) => (
                    <tr key={receta.id} className="border-t border-border">
                      <td className="py-2 font-medium text-foreground">
                        {receta.product_name}
                        {receta.variant_name && (
                          <span className="text-muted-foreground"> · {receta.variant_name}</span>
                        )}
                        {!receta.active && (
                          <span className="ml-2 text-xs text-muted-foreground">(inactiva)</span>
                        )}
                      </td>
                      <td className="py-2 text-center">{receta.component_count}</td>
                      <td className="py-2 text-right">{pesos(receta.price_cents)}</td>
                      <td className="py-2 text-right">{pesos(receta.theoretical_cost_cents)}</td>
                      <td
                        className={`py-2 text-right font-semibold ${
                          receta.margin_percent !== null && receta.margin_percent < 0
                            ? 'text-destructive'
                            : 'text-foreground'
                        }`}
                      >
                        {receta.margin_percent === null ? '—' : `${receta.margin_percent}%`}
                      </td>
                      <td className="py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => void abrir(receta.product_id)}>
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function EditorReceta({
  api,
  productos,
  productId,
  receta,
  onCerrar,
  onGuardado,
  onEliminado,
  onError
}: {
  api: ApiClient;
  productos: ProductItem[];
  productId: string;
  receta: Recipe | null;
  onCerrar: () => void;
  onGuardado: (receta: Recipe) => Promise<void>;
  onEliminado: () => Promise<void>;
  onError: (mensaje: string) => void;
}) {
  const [rendimiento, setRendimiento] = useState(String(receta?.yield_qty ?? 1));
  const [activa, setActiva] = useState(receta?.active ?? true);
  const [guardando, setGuardando] = useState(false);
  const [componentes, setComponentes] = useState<ComponenteEditable[]>(
    receta?.components.map((componente) => ({
      ingredient_product_id: componente.ingredient_product_id,
      qty: String(componente.qty),
      waste_percent: String(componente.waste_percent)
    })) ?? [{ ingredient_product_id: '', qty: '1', waste_percent: '0' }]
  );

  const plato = productos.find((producto) => producto.id === productId);
  const disponibles = useMemo(
    () => productos.filter((producto) => producto.id !== productId),
    [productos, productId]
  );

  /**
   * El costo no se estima aquí. El listado de productos no expone el costo de compra, y aun
   * si lo hiciera, el número bueno es el del servidor: es el único que sigue las recetas
   * anidadas —una salsa cuesta lo que cuestan sus ingredientes, no lo que diga su costo de
   * compra, que en una salsa suele ser cero—. Se muestra el de la última vez que se guardó.
   */
  const costoGuardado = receta?.theoretical_cost_cents ?? null;

  async function guardar() {
    setGuardando(true);
    try {
      const guardada = await api.upsertRecipe(productId, {
        yield_qty: Number(rendimiento) || 1,
        active: activa,
        components: componentes
          .filter((componente) => componente.ingredient_product_id)
          .map((componente) => ({
            ingredient_product_id: componente.ingredient_product_id,
            qty: Number(componente.qty) || 0,
            waste_percent: Number(componente.waste_percent) || 0
          }))
      });
      await onGuardado(guardada);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!receta) return;
    setGuardando(true);
    try {
      await api.deleteRecipe(receta.id);
      await onEliminado();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  }

  const precio = receta?.price_cents ?? plato?.price_cents ?? 0;

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold text-foreground">
          Receta de {receta?.product_name ?? plato?.name ?? 'este producto'}
        </h2>
        <div className="flex gap-2">
          {receta && (
            <Button variant="outline" onClick={() => void eliminar()} disabled={guardando}>
              Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar receta'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Rendimiento (unidades que produce)</span>
          <input
            type="number"
            min="0.001"
            step="any"
            className="border border-border rounded-lg px-3 py-2 bg-background w-40"
            value={rendimiento}
            onChange={(evento) => setRendimiento(evento.target.value)}
          />
        </label>
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={activa} onChange={(evento) => setActiva(evento.target.checked)} />
          <span>Activa (descuenta inventario al vender)</span>
        </label>
      </div>

      <div className="space-y-2">
        {componentes.map((componente, indice) => (
          <div key={indice} className="flex flex-wrap gap-2 items-end">
            <select
              className="border border-border rounded-lg px-3 py-2 bg-background text-sm flex-1 min-w-[12rem]"
              value={componente.ingredient_product_id}
              onChange={(evento) =>
                setComponentes((previos) =>
                  previos.map((item, i) =>
                    i === indice ? { ...item, ingredient_product_id: evento.target.value } : item
                  )
                )
              }
            >
              <option value="">Ingrediente…</option>
              {disponibles.map((producto) => (
                <option key={producto.id} value={producto.id}>
                  {producto.name}
                </option>
              ))}
            </select>
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">Cantidad</span>
              <input
                type="number"
                step="any"
                min="0"
                className="border border-border rounded-lg px-3 py-2 bg-background w-28 text-sm text-foreground"
                value={componente.qty}
                onChange={(evento) =>
                  setComponentes((previos) =>
                    previos.map((item, i) => (i === indice ? { ...item, qty: evento.target.value } : item))
                  )
                }
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="block mb-1">Merma %</span>
              <input
                type="number"
                step="any"
                min="0"
                max="99"
                className="border border-border rounded-lg px-3 py-2 bg-background w-24 text-sm text-foreground"
                value={componente.waste_percent}
                onChange={(evento) =>
                  setComponentes((previos) =>
                    previos.map((item, i) =>
                      i === indice ? { ...item, waste_percent: evento.target.value } : item
                    )
                  )
                }
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComponentes((previos) => previos.filter((_, i) => i !== indice))}
            >
              Quitar
            </Button>
          </div>
        ))}

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setComponentes((previos) => [...previos, { ingredient_product_id: '', qty: '1', waste_percent: '0' }])
          }
        >
          Añadir ingrediente
        </Button>
      </div>

      <div className="border-t border-border pt-3 flex flex-wrap gap-6 text-sm">
        <span>
          Costo teórico:{' '}
          <strong className="text-foreground">
            {costoGuardado === null ? 'al guardar' : pesos(costoGuardado)}
          </strong>
        </span>
        <span>
          Precio: <strong className="text-foreground">{pesos(precio)}</strong>
        </span>
        <span>
          Margen:{' '}
          <strong
            className={
              receta?.margin_percent !== null && receta?.margin_percent !== undefined && receta.margin_percent < 0
                ? 'text-destructive'
                : 'text-foreground'
            }
          >
            {receta?.margin_percent === null || receta?.margin_percent === undefined
              ? '—'
              : `${receta.margin_percent}%`}
          </strong>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        La merma es lo que se compra y no llega al plato: la cebolla pierde piel y la carne pierde
        agua. Sin ella el escandallo cuadra en el papel y nunca contra el conteo físico.
      </p>
    </Card>
  );
}

function DesviacionPanel({ api, branchId }: { api: ApiClient; branchId?: string }) {
  const [desde, setDesde] = useState(hoyLocal(-30));
  const [hasta, setHasta] = useState(hoyLocal());
  const [filas, setFilas] = useState<ConsumptionDeviationRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setFilas(await api.getConsumptionDeviation({ from: desde, to: hasta, branch_id: branchId }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCargando(false);
    }
  }, [api, desde, hasta, branchId]);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  const fugaTotal = filas.reduce(
    (total, fila) => total + (fila.deviation_cost_cents < 0 ? fila.deviation_cost_cents : 0),
    0
  );

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Desde</span>
            <input
              type="date"
              className="border border-border rounded-lg px-3 py-2 bg-background"
              value={desde}
              onChange={(evento) => setDesde(evento.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground mb-1">Hasta</span>
            <input
              type="date"
              className="border border-border rounded-lg px-3 py-2 bg-background"
              value={hasta}
              onChange={(evento) => setHasta(evento.target.value)}
            />
          </label>
          <Button onClick={() => void consultar()} disabled={cargando}>
            {cargando ? 'Calculando…' : 'Actualizar'}
          </Button>
        </div>

        {filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin consumo por receta en el periodo. La desviación aparece cuando hay ventas de platos
            con receta y conteos físicos con los que compararlas.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-2">Ingrediente</th>
                    <th className="py-2 text-right">Consumo teórico</th>
                    <th className="py-2 text-right">Ajuste del conteo</th>
                    <th className="py-2 text-right">Desviación</th>
                    <th className="py-2 text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((fila) => (
                    <tr key={fila.product_id} className="border-t border-border">
                      <td className="py-2 font-medium text-foreground">{fila.product_name}</td>
                      <td className="py-2 text-right">{fila.theoretical_qty}</td>
                      <td className="py-2 text-right">{fila.adjusted_qty}</td>
                      <td
                        className={`py-2 text-right font-semibold ${
                          (fila.deviation_percent ?? 0) < 0 ? 'text-destructive' : 'text-foreground'
                        }`}
                      >
                        {fila.deviation_percent === null ? '—' : `${fila.deviation_percent}%`}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          fila.deviation_cost_cents < 0 ? 'text-destructive' : 'text-foreground'
                        }`}
                      >
                        {pesos(fila.deviation_cost_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-sm">
              Se fue en faltantes:{' '}
              <strong className="text-destructive">{pesos(fugaTotal)}</strong> en el periodo.
            </p>
          </>
        )}
      </Card>

      <p className="text-xs text-muted-foreground">
        Un −8 % en el aceite significa que se está yendo un ocho por ciento más de lo que las
        recetas explican: por porciones generosas, por derrame o porque alguien se lo lleva. El
        informe no dice cuál de las tres, pero dice dónde mirar.
      </p>
    </div>
  );
}
