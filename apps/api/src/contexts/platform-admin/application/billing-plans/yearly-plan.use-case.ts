import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

export interface CreateYearlyInput {
  sourcePlanId: string;
  discountPercent: number;
  /** Precio anual explícito. Si no viene, sale de doce mensualidades con el descuento. */
  priceCents?: number;
}

/**
 * Crea (o actualiza) el plan anual equivalente a uno mensual.
 *
 * Copia límites y módulos del plan de origen porque un plan anual que da menos que su
 * mensual es un error de captura esperando a ocurrir, y el comercio lo descubre el día que
 * intenta crear la sucursal número cuatro.
 */
export async function createYearlyCounterpart(db: Kysely<Database>, input: CreateYearlyInput) {
  const source = await db
    .selectFrom('billing_plans')
    .selectAll()
    .where('id', '=', input.sourcePlanId)
    .executeTakeFirst();

  if (!source) throw new AppError(404, 'PLAN_NOT_FOUND', 'El plan de origen no existe');

  if (source.billing_cycle === 'YEARLY') {
    throw new AppError(400, 'PLAN_ALREADY_YEARLY', 'Ese plan ya es anual');
  }

  const yearlyId = `${source.id}_YEARLY`;
  const priceCents =
    input.priceCents ?? Math.round(source.price_cents * 12 * (1 - input.discountPercent / 100));

  return db.transaction().execute(async (trx) => {
    await trx
      .insertInto('billing_plans')
      .values({
        id: yearlyId,
        name: `${source.name} (anual)`,
        price_cents: priceCents,
        billing_cycle: 'YEARLY',
        features_json: source.features_json,
        active: true,
        metadata_json: {
          derived_from: source.id,
          discount_percent: input.discountPercent,
          monthly_equivalent_cents: Math.round(priceCents / 12)
        }
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          name: `${source.name} (anual)`,
          price_cents: priceCents,
          billing_cycle: 'YEARLY',
          active: true
        })
      )
      .execute();

    // Los entitlements se copian tal cual: mismos límites, mismos módulos.
    const limits = await trx
      .selectFrom('plan_entitlements')
      .select(['entitlement_key', 'limit_value'])
      .where('plan_id', '=', source.id)
      .execute();

    const modules = await trx.selectFrom('plan_modules').select('module').where('plan_id', '=', source.id).execute();

    await trx.deleteFrom('plan_entitlements').where('plan_id', '=', yearlyId).execute();
    await trx.deleteFrom('plan_modules').where('plan_id', '=', yearlyId).execute();

    if (limits.length > 0) {
      await trx
        .insertInto('plan_entitlements')
        .values(limits.map((row) => ({ plan_id: yearlyId, ...row })))
        .execute();
    }

    if (modules.length > 0) {
      await trx
        .insertInto('plan_modules')
        .values(modules.map((row) => ({ plan_id: yearlyId, module: row.module })))
        .execute();
    }

    return {
      id: yearlyId,
      name: `${source.name} (anual)`,
      price_cents: priceCents,
      billing_cycle: 'YEARLY',
      monthly_equivalent_cents: Math.round(priceCents / 12),
      discount_percent: input.discountPercent
    };
  });
}
