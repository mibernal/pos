import { Kysely, Transaction } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { computeProration } from './preview-plan-change.use-case.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';
import { resolveBillingPlan, periodDaysForCycle } from '../billing-plans/resolve-plan.js';
import { LIVE_SUBSCRIPTION_STATUSES } from '../../../billing/application/subscription.service.js';
import type { EntitlementsResolver } from '../../../../shared/infra/entitlements/entitlements-resolver.js';

export class ChangeTenantPlanUseCase {
  constructor(
    private readonly db: Kysely<Database>,
    /** Cambiar de plan cambia módulos y límites: la caché tiene que caer con el cambio. */
    private readonly entitlements?: EntitlementsResolver
  ) {}

  async execute(tenantId: string, newPlan: string, actorId: string, actorEmail: string) {
    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (!tenant) throw new AppError(404, 'NOT_FOUND', 'Tenant no encontrado');

    const planRow = await resolveBillingPlan(this.db, newPlan);

    await this.db.transaction().execute(async (trx) => {
      // Antes solo se consideraba `ACTIVE`: a un comercio en prueba o en mora se le creaba
      // una segunda suscripción en vez de cambiarle el plan a la que ya tenía.
      const sub = await trx.selectFrom('tenant_subscriptions')
        .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
        .where('tenant_subscriptions.tenant_id', '=', tenantId)
        .where('tenant_subscriptions.status', 'in', LIVE_SUBSCRIPTION_STATUSES)
        .orderBy('tenant_subscriptions.created_at', 'desc')
        .select([
          'tenant_subscriptions.id',
          'tenant_subscriptions.current_period_end',
          'billing_plans.name as old_plan_name',
          // El prorrateo se calcula contra el plan que **se deja**, así que sus cifras hay
          // que leerlas aquí: dos líneas más abajo `plan_id` ya apunta al nuevo.
          'billing_plans.price_cents as old_price_cents',
          'billing_plans.billing_cycle as old_billing_cycle'
        ])
        .executeTakeFirst();
      
      if (sub) {
        await trx.updateTable('tenant_subscriptions')
          .set({ plan_id: planRow.id })
          .where('id', '=', sub.id)
          .execute();
          
        await trx.insertInto('subscription_events').values({
          subscription_id: sub.id,
          type: 'PLAN_CHANGED',
          metadata: { old_plan: sub.old_plan_name, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await aplicarProrrateo(trx, {
          tenantId,
          subscriptionId: sub.id,
          periodEnd: sub.current_period_end,
          precioAnteriorCents: sub.old_price_cents,
          cicloAnterior: sub.old_billing_cycle,
          planNuevoNombre: planRow.name,
          precioNuevoCents: planRow.price_cents,
          cicloNuevo: planRow.billing_cycle
        });

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: sub.old_plan_name, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

      } else {
        const newSubId = randomUUID();
        const periodStart = new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + periodDaysForCycle(planRow.billing_cycle));

        await trx.insertInto('tenant_subscriptions').values({
          id: newSubId,
          tenant_id: tenantId,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: periodStart,
          current_period_end: periodEnd,
          starts_at: periodStart,
          expires_at: periodEnd
        }).execute();
        
        await trx.insertInto('subscription_events').values({
          subscription_id: newSubId,
          type: 'PLAN_CREATED',
          metadata: { plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();

        await trx.insertInto('platform_events').values({
          tenant_id: tenantId,
          type: 'TENANT_PLAN_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { old_plan: null, new_plan: planRow.id } as any // eslint-disable-line @typescript-eslint/no-explicit-any
        }).execute();
      }
    });

    await this.entitlements?.invalidate(tenantId);
  }
}

/**
 * Aplica lo que `/plan/preview` prometió: ajusta el periodo y deja el cargo apuntado.
 *
 * Hasta la fase 13 esto no existía. El preview calculaba el prorrateo, se lo enseñaba al
 * comercio y el cambio de plan cambiaba `plan_id` y nada más: ni ajustaba el fin de
 * periodo ni emitía el cargo. Lo que el cliente veía antes de aceptar no era lo que
 * pasaba después — que en un producto que cobra es de las cosas peores que se pueden
 * hacer, porque el que lo descubre es siempre el cliente.
 *
 * Se usa **la misma** `computeProration` que el preview, a propósito. Dos cálculos de la
 * misma cifra escritos por separado divergen; y cuando lo que divergen son pesos, la
 * discrepancia se resuelve en una llamada de soporte.
 *
 * El cargo no se cobra aquí: se apunta para la próxima factura. Ver la migración 112.
 */
async function aplicarProrrateo(
  trx: Transaction<Database>,
  input: {
    tenantId: string;
    subscriptionId: string;
    periodEnd: Date | null;
    precioAnteriorCents: number;
    cicloAnterior: string;
    planNuevoNombre: string;
    precioNuevoCents: number;
    cicloNuevo: string;
  }
) {
  const prorrateo = computeProration({
    periodEnd: input.periodEnd,
    currentPriceCents: input.precioAnteriorCents,
    currentCycleDays: periodDaysForCycle(input.cicloAnterior),
    targetPriceCents: input.precioNuevoCents,
    targetCycleDays: periodDaysForCycle(input.cicloNuevo)
  });

  await trx
    .updateTable('tenant_subscriptions')
    .set({
      // El esquema compartido devuelve la fecha como texto ISO (viaja tal cual al panel).
      // A la columna `timestamptz` se le pasa un `Date`: con la cadena funcionaba en tiempo
      // de ejecución, pero rompía el typecheck desde la fase 13.
      current_period_end: new Date(prorrateo.new_period_end),
      expires_at: new Date(prorrateo.new_period_end)
    })
    .where('id', '=', input.subscriptionId)
    .execute();

  // Cero no se apunta: una fila de importe cero es ruido en la factura y en el rastro.
  if (prorrateo.charge_cents > 0) {
    await trx
      .insertInto('subscription_pending_charges')
      .values({
        id: randomUUID(),
        tenant_id: input.tenantId,
        subscription_id: input.subscriptionId,
        description: `Ajuste por cambio a ${input.planNuevoNombre}`,
        amount_cents: prorrateo.charge_cents
      })
      .execute();
  }

  await trx
    .insertInto('subscription_events')
    .values({
      subscription_id: input.subscriptionId,
      type: 'PRORATION_APPLIED',
      metadata: prorrateo as any // eslint-disable-line @typescript-eslint/no-explicit-any
    })
    .execute();
}
