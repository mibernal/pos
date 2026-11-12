import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import {
  MAX_RECIPE_DEPTH,
  consumptionPerUnit,
  marginPercent,
  type Recipe,
  type RecipeComponentView,
  type UpsertRecipeInput
} from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';

interface IngredienteCosteable {
  productId: string;
  variantId: string | null;
}

/**
 * Recetas y escandallo.
 *
 * Una receta dice qué consume un plato. Con eso, vender una hamburguesa baja pan, carne y
 * queso en vez de bajar «hamburguesa» —un producto que nadie compra ni almacena— y el costo
 * del plato deja de ser un número escrito a mano para pasar a calcularse.
 *
 * El ingrediente es un producto más. No hay tabla de ingredientes aparte porque la carne que
 * entra por una recepción y la que sale por una receta son la misma carne, y lo contrario
 * obligaría a mantener dos existencias del mismo bien.
 */
export class RecipesService {
  /**
   * Costo de una unidad, siguiendo las recetas anidadas.
   *
   * Una salsa que tiene su propia receta no cuesta lo que diga `products.cost_cents` —ahí
   * suele haber un cero, porque la salsa no se compra— sino lo que cuestan sus ingredientes.
   * El memo evita repetir la consulta cuando el mismo ingrediente aparece en varias ramas.
   */
  private static async unitCostCents(
    trx: Transaction<Database>,
    tenantId: string,
    target: IngredienteCosteable,
    memo: Map<string, number>,
    depth = 0
  ): Promise<number> {
    const clave = `${target.productId}|${target.variantId ?? ''}`;
    const cacheado = memo.get(clave);
    if (cacheado !== undefined) return cacheado;

    const producto = await trx
      .selectFrom('products')
      .select(['cost_cents'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', target.productId)
      .executeTakeFirst();

    const costoPropio = Number(producto?.cost_cents ?? 0);

    if (depth >= MAX_RECIPE_DEPTH) {
      memo.set(clave, costoPropio);
      return costoPropio;
    }

    const receta = await this.findRecipeRow(trx, tenantId, target.productId, target.variantId, true);
    if (!receta) {
      memo.set(clave, costoPropio);
      return costoPropio;
    }

    const componentes = await trx
      .selectFrom('recipe_components')
      .select(['ingredient_product_id', 'ingredient_variant_id', 'qty', 'waste_percent'])
      .where('recipe_id', '=', receta.id)
      .execute();

    let total = 0;
    for (const componente of componentes) {
      const porUnidad = consumptionPerUnit(
        Number(componente.qty),
        Number(componente.waste_percent),
        Number(receta.yield_qty)
      );
      const costoIngrediente = await this.unitCostCents(
        trx,
        tenantId,
        { productId: componente.ingredient_product_id, variantId: componente.ingredient_variant_id },
        memo,
        depth + 1
      );
      total += porUnidad * costoIngrediente;
    }

    memo.set(clave, total);
    return total;
  }

  /**
   * La receta de la variante manda sobre la del producto: la pizza familiar lleva el doble
   * de todo, y si no se eligiera la más específica descargaría los ingredientes de la
   * personal.
   */
  private static async findRecipeRow(
    trx: Transaction<Database>,
    tenantId: string,
    productId: string,
    variantId: string | null,
    soloActivas: boolean
  ) {
    let query = trx
      .selectFrom('product_recipes')
      .select(['id', 'product_id', 'variant_id', 'yield_qty', 'active', 'notes'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', '=', productId);

    if (soloActivas) query = query.where('active', '=', true);

    const recetas = await query.execute();
    if (recetas.length === 0) return null;

    const especifica = variantId ? recetas.find((r) => r.variant_id === variantId) : undefined;
    return especifica ?? recetas.find((r) => r.variant_id === null) ?? null;
  }

  /**
   * ¿Se llega desde alguno de estos ingredientes hasta este producto?
   *
   * Es la comprobación que impide que el pan lleve hamburguesa: una receta circular no da un
   * error visible, da una expansión que no termina, y el sitio de cortarla es el alta —donde
   * hay una persona mirando— y no la descarga de inventario a las once de la noche.
   *
   * `UNION` en vez de `UNION ALL` a propósito: deduplica, así que la consulta termina incluso
   * si en los datos ya hubiera un ciclo.
   */
  private static async alcanzaProducto(
    trx: Transaction<Database>,
    tenantId: string,
    desde: string[],
    objetivo: string
  ): Promise<boolean> {
    const resultado = await sql<{ ok: number }>`
      WITH RECURSIVE alcanzables(product_id, depth) AS (
        SELECT unnest(${sql.val(desde)}::uuid[]), 1
        UNION
        SELECT rc.ingredient_product_id, a.depth + 1
          FROM alcanzables a
          JOIN product_recipes pr
            ON pr.tenant_id = ${tenantId}::uuid AND pr.active AND pr.product_id = a.product_id
          JOIN recipe_components rc ON rc.recipe_id = pr.id
         WHERE a.depth < ${MAX_RECIPE_DEPTH}
      )
      SELECT 1 AS ok FROM alcanzables WHERE product_id = ${objetivo}::uuid LIMIT 1
    `.execute(trx);

    return resultado.rows.length > 0;
  }

  /** Crea o reemplaza la receta de un producto. Los componentes se reemplazan enteros. */
  static async upsert(
    trx: Transaction<Database>,
    tenantId: string,
    productId: string,
    input: UpsertRecipeInput
  ): Promise<Recipe> {
    const variantId = input.variant_id ?? null;

    const producto = await trx
      .selectFrom('products')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!producto) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'El producto de la receta no existe.');
    }

    if (variantId) {
      const variante = await trx
        .selectFrom('product_variants')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', variantId)
        .where('product_id', '=', productId)
        .executeTakeFirst();

      if (!variante) {
        throw new AppError(404, 'VARIANT_NOT_FOUND', 'Esa variante no pertenece al producto.');
      }
    }

    const ingredientIds = [...new Set(input.components.map((c) => c.ingredient_product_id))];

    if (ingredientIds.includes(productId)) {
      throw new AppError(
        400,
        'RECIPE_SELF_REFERENCE',
        'Un producto no puede ser ingrediente de sí mismo.'
      );
    }

    const existentes = await trx
      .selectFrom('products')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', ingredientIds)
      .execute();

    if (existentes.length !== ingredientIds.length) {
      throw new AppError(404, 'INGREDIENT_NOT_FOUND', 'Alguno de los ingredientes no existe.');
    }

    if (await this.alcanzaProducto(trx, tenantId, ingredientIds, productId)) {
      throw new AppError(
        400,
        'RECIPE_CYCLE',
        'Esa receta se muerde la cola: alguno de los ingredientes acaba llevando este mismo producto.'
      );
    }

    const previa = await this.findRecipeRow(trx, tenantId, productId, variantId, false);
    /**
     * `findRecipeRow` cae a la receta de producto cuando la variante no tiene la suya, y aquí
     * eso sería fatal: editar la variante reescribiría la receta general. Solo se reutiliza
     * la fila si apunta exactamente al mismo destino.
     */
    const mismaFila = previa && previa.variant_id === variantId ? previa : null;

    const recipeId = mismaFila?.id ?? randomUUID();

    if (mismaFila) {
      await trx
        .updateTable('product_recipes')
        .set({
          yield_qty: String(input.yield_qty),
          active: input.active,
          notes: input.notes ?? null,
          updated_at: new Date()
        })
        .where('id', '=', recipeId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx.deleteFrom('recipe_components').where('recipe_id', '=', recipeId).execute();
    } else {
      await trx
        .insertInto('product_recipes')
        .values({
          id: recipeId,
          tenant_id: tenantId,
          product_id: productId,
          variant_id: variantId,
          yield_qty: String(input.yield_qty),
          active: input.active,
          notes: input.notes ?? null
        })
        .execute();
    }

    await trx
      .insertInto('recipe_components')
      .values(
        input.components.map((componente) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          recipe_id: recipeId,
          ingredient_product_id: componente.ingredient_product_id,
          ingredient_variant_id: componente.ingredient_variant_id ?? null,
          qty: String(componente.qty),
          waste_percent: String(componente.waste_percent)
        }))
      )
      .execute();

    const receta = await this.get(trx, tenantId, productId, variantId);
    if (!receta) {
      throw new AppError(500, 'RECIPE_NOT_PERSISTED', 'La receta no se pudo leer después de guardarla.');
    }
    return receta;
  }

  /** El escandallo de un plato: sus componentes, su costo teórico y su margen. */
  static async get(
    trx: Transaction<Database>,
    tenantId: string,
    productId: string,
    variantId: string | null
  ): Promise<Recipe | null> {
    const receta = await this.findRecipeRow(trx, tenantId, productId, variantId, false);
    if (!receta) return null;

    const producto = await trx
      .selectFrom('products')
      .select(['name', 'price_cents'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', productId)
      .executeTakeFirst();

    const componentes = await trx
      .selectFrom('recipe_components as rc')
      .innerJoin('products as p', (join) =>
        join.onRef('p.id', '=', 'rc.ingredient_product_id').onRef('p.tenant_id', '=', 'rc.tenant_id')
      )
      .select([
        'rc.ingredient_product_id',
        'rc.ingredient_variant_id',
        'rc.qty',
        'rc.waste_percent',
        'p.name as ingredient_name'
      ])
      .where('rc.recipe_id', '=', receta.id)
      .orderBy('p.name')
      .execute();

    const yieldQty = Number(receta.yield_qty);
    const memo = new Map<string, number>();
    const vista: RecipeComponentView[] = [];
    let costoTotal = 0;

    for (const componente of componentes) {
      const porUnidad = consumptionPerUnit(
        Number(componente.qty),
        Number(componente.waste_percent),
        yieldQty
      );
      const costoUnitario = await this.unitCostCents(
        trx,
        tenantId,
        {
          productId: componente.ingredient_product_id,
          variantId: componente.ingredient_variant_id
        },
        memo,
        1
      );
      const costoComponente = porUnidad * costoUnitario;
      costoTotal += costoComponente;

      vista.push({
        ingredient_product_id: componente.ingredient_product_id,
        ingredient_variant_id: componente.ingredient_variant_id,
        ingredient_name: componente.ingredient_name,
        qty: Number(componente.qty),
        waste_percent: Number(componente.waste_percent),
        qty_per_unit: Number(porUnidad.toFixed(4)),
        unit_cost_cents: Math.round(costoUnitario),
        cost_cents: Math.round(costoComponente)
      });
    }

    /**
     * El total se redondea desde la suma sin redondear, no sumando los componentes ya
     * redondeados. Con ingredientes baratos —un gramo de sal cuesta una fracción de peso— la
     * segunda forma da cero y el escandallo diría que el plato no cuesta nada.
     */
    const theoreticalCost = Math.round(costoTotal);
    const priceCents = Number(producto?.price_cents ?? 0);

    return {
      id: receta.id,
      product_id: productId,
      product_name: producto?.name ?? '',
      variant_id: receta.variant_id,
      yield_qty: yieldQty,
      active: receta.active,
      notes: receta.notes,
      components: vista,
      theoretical_cost_cents: theoreticalCost,
      price_cents: priceCents,
      margin_percent: marginPercent(priceCents, theoreticalCost)
    };
  }

  /** Qué platos tienen receta, para la pantalla de configuración. */
  static async list(trx: Transaction<Database>, tenantId: string) {
    const recetas = await trx
      .selectFrom('product_recipes as pr')
      .innerJoin('products as p', (join) =>
        join.onRef('p.id', '=', 'pr.product_id').onRef('p.tenant_id', '=', 'pr.tenant_id')
      )
      .leftJoin('product_variants as v', 'v.id', 'pr.variant_id')
      .select((eb) => [
        'pr.id',
        'pr.product_id',
        'pr.variant_id',
        'pr.yield_qty',
        'pr.active',
        'p.name as product_name',
        'p.price_cents',
        'v.name as variant_name',
        eb
          .selectFrom('recipe_components as rc')
          .select((inner) => inner.fn.countAll<number>().as('n'))
          .whereRef('rc.recipe_id', '=', 'pr.id')
          .as('component_count')
      ])
      .where('pr.tenant_id', '=', tenantId)
      .orderBy('p.name')
      .execute();

    const memo = new Map<string, number>();

    return Promise.all(
      recetas.map(async (receta) => {
        const costo = Math.round(
          await this.unitCostCents(
            trx,
            tenantId,
            { productId: receta.product_id, variantId: receta.variant_id },
            memo
          )
        );
        const precio = Number(receta.price_cents);
        return {
          id: receta.id,
          product_id: receta.product_id,
          product_name: receta.product_name,
          variant_id: receta.variant_id,
          variant_name: receta.variant_name,
          yield_qty: Number(receta.yield_qty),
          active: receta.active,
          component_count: Number(receta.component_count ?? 0),
          price_cents: precio,
          theoretical_cost_cents: costo,
          margin_percent: marginPercent(precio, costo)
        };
      })
    );
  }

  /**
   * Borra la receta. Los movimientos de inventario que ya la usaron no se tocan: son
   * historia y describen lo que de verdad se consumió.
   */
  static async remove(trx: Transaction<Database>, tenantId: string, recipeId: string): Promise<void> {
    const borrada = await trx
      .deleteFrom('product_recipes')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', recipeId)
      .executeTakeFirst();

    if (Number(borrada.numDeletedRows ?? 0) === 0) {
      throw new AppError(404, 'RECIPE_NOT_FOUND', 'Esa receta no existe.');
    }
  }
}
