import { CompiledQuery, type Kysely, type Transaction } from 'kysely';
import { MAX_RECIPE_DEPTH, consumptionPerUnit } from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';

/**
 * Expansión de recetas: de lo que se vendió a lo que se consumió.
 *
 * Vive aquí y no en el worker aunque sea el worker quien descarga el inventario, porque el
 * mismo cálculo lo necesita el informe de desviación: si la descarga y el informe usaran
 * dos implementaciones, el informe compararía el consumo teórico contra un consumo real
 * calculado de otra forma y la desviación mediría la diferencia entre dos programas, no
 * entre la receta y la realidad.
 *
 * Por eso no depende de Kysely ni de `pg`, sino de lo único que ambos saben hacer: correr
 * una consulta con parámetros.
 */
export interface RecipeQueryRunner {
  query<R>(text: string, params: readonly unknown[]): Promise<{ rows: R[] }>;
}

/** Adaptador para el lado del API, que habla Kysely. */
export function runnerFromKysely(db: Kysely<Database> | Transaction<Database>): RecipeQueryRunner {
  return {
    query: async <R>(text: string, params: readonly unknown[]) => {
      const result = await db.executeQuery<R>(CompiledQuery.raw(text, [...params]));
      return { rows: result.rows };
    }
  };
}

export interface DemandLine {
  productId: string;
  variantId: string | null;
  qty: number;
}

export interface ExpandedLine extends DemandLine {
  /** `true` si esta cantidad salió de una receta y no de haber vendido el producto en sí. */
  viaRecipe: boolean;
}

export interface ExpansionResult {
  lines: ExpandedLine[];
  /**
   * Productos que seguían teniendo receta al agotarse la profundidad máxima. Se descargan
   * ellos mismos en vez de sus ingredientes —perder el movimiento sería peor— pero hay que
   * poder verlo en el log: una receta anidada cinco niveles casi siempre es un error de
   * captura.
   */
  truncated: string[];
}

interface ComponentRow {
  recipe_id: string;
  product_id: string;
  variant_id: string | null;
  yield_qty: string;
  ingredient_product_id: string;
  ingredient_variant_id: string | null;
  qty: string;
  waste_percent: string;
}

interface LoadedRecipe {
  variantId: string | null;
  yieldQty: number;
  components: Array<{ productId: string; variantId: string | null; qty: number; wastePercent: number }>;
}

/**
 * La granularidad del inventario es de tres decimales (`numeric(15,3)` en balances y en
 * movimientos). Redondear aquí y no en la base es deliberado: así el balance, el movimiento
 * y el kardex escriben exactamente el mismo número, en vez de que cada uno lo redondee por
 * su cuenta y el saldo deje de cuadrar con la suma de sus movimientos.
 */
function redondear(qty: number): number {
  return Math.round(qty * 1000) / 1000;
}

function claveLinea(productId: string, variantId: string | null): string {
  return `${productId}|${variantId ?? ''}`;
}

async function loadRecipes(
  runner: RecipeQueryRunner,
  tenantId: string,
  productIds: string[]
): Promise<Map<string, LoadedRecipe[]>> {
  const porProducto = new Map<string, LoadedRecipe[]>();
  if (productIds.length === 0) return porProducto;

  const { rows } = await runner.query<ComponentRow>(
    `SELECT pr.id AS recipe_id, pr.product_id, pr.variant_id, pr.yield_qty,
            rc.ingredient_product_id, rc.ingredient_variant_id, rc.qty, rc.waste_percent
       FROM product_recipes pr
       JOIN recipe_components rc ON rc.recipe_id = pr.id
      WHERE pr.tenant_id = $1::uuid
        AND pr.active
        AND pr.product_id = ANY($2::uuid[])`,
    [tenantId, productIds]
  );

  const porReceta = new Map<string, LoadedRecipe>();
  for (const row of rows) {
    let receta = porReceta.get(row.recipe_id);
    if (!receta) {
      receta = { variantId: row.variant_id, yieldQty: Number(row.yield_qty), components: [] };
      porReceta.set(row.recipe_id, receta);
      const lista = porProducto.get(row.product_id) ?? [];
      lista.push(receta);
      porProducto.set(row.product_id, lista);
    }
    receta.components.push({
      productId: row.ingredient_product_id,
      variantId: row.ingredient_variant_id,
      qty: Number(row.qty),
      wastePercent: Number(row.waste_percent)
    });
  }

  return porProducto;
}

/**
 * La receta de la variante manda sobre la del producto.
 *
 * Una pizza tiene receta de pizza, y la variante «familiar» lleva el doble de todo. Si no se
 * eligiera la más específica, la familiar descargaría los ingredientes de la personal y el
 * inventario se iría quedando corto sin que nadie sepa por qué.
 */
function pickRecipe(recetas: LoadedRecipe[] | undefined, variantId: string | null): LoadedRecipe | null {
  if (!recetas || recetas.length === 0) return null;
  const especifica = variantId ? recetas.find((r) => r.variantId === variantId) : undefined;
  return especifica ?? recetas.find((r) => r.variantId === null) ?? null;
}

/**
 * Convierte lo vendido en lo que hay que descontar del inventario.
 *
 * Un producto con receta activa **no se descuenta a sí mismo**: se descuentan sus
 * ingredientes. Un plato no se almacena, se prepara; llevarle existencias a la hamburguesa
 * además de al pan y a la carne sería contar el mismo inventario dos veces.
 */
export async function expandDemand(
  runner: RecipeQueryRunner,
  tenantId: string,
  lines: DemandLine[]
): Promise<ExpansionResult> {
  const salida = new Map<string, ExpandedLine>();
  const truncated: string[] = [];

  const acumular = (linea: DemandLine, viaRecipe: boolean) => {
    const qty = redondear(linea.qty);
    /**
     * Un movimiento de cero no dice nada y ensucia el kardex. Ocurre con ingredientes por
     * debajo del gramo: el sistema mide en tres decimales y lo que no llega a ese umbral no
     * se puede representar. El sitio de esa precisión es la unidad de compra —gramos en vez
     * de kilos—, no un movimiento fantasma.
     */
    if (qty <= 0) return;
    const clave = claveLinea(linea.productId, linea.variantId);
    const previa = salida.get(clave);
    if (previa) {
      previa.qty = redondear(previa.qty + qty);
      previa.viaRecipe = previa.viaRecipe && viaRecipe;
      return;
    }
    salida.set(clave, { productId: linea.productId, variantId: linea.variantId, qty, viaRecipe });
  };

  let pendientes = lines;

  /**
   * Termina siempre: al llegar a la profundidad máxima ninguna línea alimenta la siguiente
   * vuelta, así que un ciclo que se hubiera colado en los datos se corta aquí aunque la
   * validación del alta lo haya dejado pasar.
   */
  for (let depth = 0; pendientes.length > 0; depth += 1) {
    const productIds = [...new Set(pendientes.map((l) => l.productId))];
    const recetas = await loadRecipes(runner, tenantId, productIds);
    const siguiente = new Map<string, DemandLine>();

    for (const linea of pendientes) {
      const receta = pickRecipe(recetas.get(linea.productId), linea.variantId);
      if (!receta) {
        acumular(linea, depth > 0);
        continue;
      }

      if (depth >= MAX_RECIPE_DEPTH) {
        truncated.push(linea.productId);
        acumular(linea, true);
        continue;
      }

      for (const componente of receta.components) {
        const consumo = linea.qty * consumptionPerUnit(componente.qty, componente.wastePercent, receta.yieldQty);
        const clave = claveLinea(componente.productId, componente.variantId);
        const previa = siguiente.get(clave);
        if (previa) {
          previa.qty += consumo;
        } else {
          siguiente.set(clave, { productId: componente.productId, variantId: componente.variantId, qty: consumo });
        }
      }
    }

    pendientes = [...siguiente.values()];
  }

  return { lines: [...salida.values()], truncated };
}
