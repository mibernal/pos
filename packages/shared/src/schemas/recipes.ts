import { z } from 'zod';

/**
 * Recetas y escandallo.
 *
 * En un restaurante, vender un plato tiene que bajar sus ingredientes. Sin eso, el módulo
 * de inventario —que es de lo mejor construido del sistema— no le sirve al vertical que el
 * producto mejor cubre: el aceite, la carne y el pan se consumen sin que nadie se entere,
 * y el costo del plato es un número escrito a mano.
 */

/** Hasta dónde se expande una receta anidada. Una salsa dentro de un plato es un nivel. */
export const MAX_RECIPE_DEPTH = 5;

export const recipeComponentSchema = z.object({
  ingredient_product_id: z.string().uuid(),
  ingredient_variant_id: z.string().uuid().nullable().optional(),
  /** Consumo de la receta **entera**, no de una unidad. */
  qty: z.number().positive().max(100_000),
  /** Merma en porcentaje: lo que se pierde al pelar, limpiar o cocinar. */
  waste_percent: z.number().min(0).max(99).default(0)
});
export type RecipeComponentInput = z.infer<typeof recipeComponentSchema>;

export const upsertRecipeSchema = z.object({
  variant_id: z.string().uuid().nullable().optional(),
  /** Cuántas unidades del plato produce la receta. */
  yield_qty: z.number().positive().max(10_000).default(1),
  active: z.boolean().default(true),
  notes: z.string().max(300).optional(),
  components: z.array(recipeComponentSchema).min(1).max(60)
});
export type UpsertRecipeInput = z.infer<typeof upsertRecipeSchema>;

export const recipeComponentViewSchema = z.object({
  ingredient_product_id: z.string().uuid(),
  ingredient_variant_id: z.string().uuid().nullable(),
  ingredient_name: z.string(),
  qty: z.number(),
  waste_percent: z.number(),
  /** Consumo real por unidad del plato, ya con merma y rendimiento aplicados. */
  qty_per_unit: z.number(),
  unit_cost_cents: z.number().int(),
  cost_cents: z.number().int()
});
export type RecipeComponentView = z.infer<typeof recipeComponentViewSchema>;

export const recipeSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  variant_id: z.string().uuid().nullable(),
  yield_qty: z.number(),
  active: z.boolean(),
  notes: z.string().nullable(),
  components: z.array(recipeComponentViewSchema),
  /** Costo teórico de una unidad del plato, sumando ingredientes con su merma. */
  theoretical_cost_cents: z.number().int(),
  price_cents: z.number().int(),
  /** Margen sobre el precio de venta. `null` si el plato no tiene precio. */
  margin_percent: z.number().nullable()
});
export type Recipe = z.infer<typeof recipeSchema>;

/**
 * Consumo real de un ingrediente por unidad del plato.
 *
 * Dos ajustes que la gente olvida y que hacen que el escandallo nunca cuadre contra el
 * conteo físico: dividir por el rendimiento —la receta rinde varias unidades— y sumar la
 * merma, que es producto que se compra y no llega al plato.
 */
export function consumptionPerUnit(qty: number, wastePercent: number, yieldQty: number): number {
  const conMerma = qty * (1 + wastePercent / 100);
  return conMerma / (yieldQty > 0 ? yieldQty : 1);
}

/**
 * Margen del plato sobre su precio de venta.
 *
 * Sobre el precio, no sobre el costo. Es la convención de la hostelería —«este plato deja
 * un 70»— y confundirla con el margen sobre costo infla la cifra lo suficiente como para
 * fijar mal una carta entera.
 */
export function marginPercent(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return Number((((priceCents - costCents) / priceCents) * 100).toFixed(2));
}

/* ------------------------------------------------------------------ *
 * Desviación contra el conteo físico
 * ------------------------------------------------------------------ */

export const consumptionDeviationRowSchema = z.object({
  product_id: z.string().uuid(),
  product_name: z.string(),
  /** Lo que las recetas dicen que debió consumirse en el periodo. */
  theoretical_qty: z.number(),
  /** Ajustes registrados tras contar: lo que faltó (negativo) o sobró (positivo). */
  adjusted_qty: z.number(),
  deviation_percent: z.number().nullable(),
  unit_cost_cents: z.number().int(),
  deviation_cost_cents: z.number().int()
});
export type ConsumptionDeviationRow = z.infer<typeof consumptionDeviationRowSchema>;

/**
 * Cuánto se desvía el consumo real del teórico.
 *
 * Un −8 % en el aceite significa que se está yendo un ocho por ciento más de lo que las
 * recetas explican. Esa cifra es la razón de ser del escandallo: sin ella, la receta solo
 * sirve para descontar inventario; con ella, sirve para encontrar la fuga.
 */
export function deviationPercent(theoreticalQty: number, adjustedQty: number): number | null {
  if (theoreticalQty <= 0) return null;
  return Number(((adjustedQty / theoreticalQty) * 100).toFixed(2));
}
