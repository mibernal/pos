import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import {
  ENTITLEMENT_KEYS,
  UNLIMITED,
  type AssignableModule,
  type EntitlementKey,
  type PlanEntitlements
} from '@pos-dian/shared';
import type { EntitlementsResolver } from '../../../../shared/infra/entitlements/entitlements-resolver.js';

/**
 * Lee y escribe lo que da un plan.
 *
 * Es la pieza que convierte «vender un plan superior» en una operación de catálogo. Antes
 * era editar la base de datos: los límites vivían en un `features_json` de dos claves y los
 * módulos en columnas por comercio que ningún plan gobernaba.
 */
export class PlanEntitlementsUseCase {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly entitlements?: EntitlementsResolver
  ) {}

  async read(planId: string): Promise<PlanEntitlements> {
    const [limits, modules] = await Promise.all([
      this.db
        .selectFrom('plan_entitlements')
        .select(['entitlement_key', 'limit_value'])
        .where('plan_id', '=', planId)
        .execute(),
      this.db.selectFrom('plan_modules').select('module').where('plan_id', '=', planId).execute()
    ]);

    // Una dimensión sin fila es ilimitada, igual que interpretaba el `?? -1` anterior.
    const resolved = Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, UNLIMITED])) as Record<
      EntitlementKey,
      number
    >;
    for (const row of limits) {
      if ((ENTITLEMENT_KEYS as readonly string[]).includes(row.entitlement_key)) {
        resolved[row.entitlement_key as EntitlementKey] = row.limit_value;
      }
    }

    return { limits: resolved, modules: modules.map((m) => m.module as AssignableModule) };
  }

  async write(planId: string, payload: Partial<PlanEntitlements>, actorId: string, actorEmail: string): Promise<void> {
    const plan = await this.db.selectFrom('billing_plans').select('id').where('id', '=', planId).executeTakeFirst();
    if (!plan) throw new AppError(404, 'NOT_FOUND', 'El plan no existe');

    const affectedTenants = await this.db
      .selectFrom('tenant_subscriptions')
      .select('tenant_id')
      .where('plan_id', '=', planId)
      .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
      .execute();

    await this.db.transaction().execute(async (trx) => {
      if (payload.limits) {
        for (const [key, value] of Object.entries(payload.limits)) {
          await trx
            .insertInto('plan_entitlements')
            .values({ plan_id: planId, entitlement_key: key, limit_value: value, updated_at: new Date() })
            .onConflict((oc) =>
              oc.columns(['plan_id', 'entitlement_key']).doUpdateSet({ limit_value: value, updated_at: new Date() })
            )
            .execute();
        }
      }

      if (payload.modules) {
        // Se reemplaza el conjunto entero: un módulo que ya no está en la lista deja de
        // formar parte del plan. Los comercios que lo tengan por excepción lo conservan —
        // para eso existen las excepciones.
        await trx.deleteFrom('plan_modules').where('plan_id', '=', planId).execute();

        if (payload.modules.length > 0) {
          await trx
            .insertInto('plan_modules')
            .values(payload.modules.map((module) => ({ plan_id: planId, module })))
            .execute();
        }
      }

      await trx
        .insertInto('platform_events')
        .values({
          tenant_id: null,
          type: 'PLAN_ENTITLEMENTS_CHANGED',
          severity: 'INFO',
          actor_id: actorId,
          actor_email: actorEmail,
          metadata: { plan_id: planId, ...payload, affected_tenants: affectedTenants.length } as never
        })
        .execute();
    });

    // Cambiar un plan cambia lo que ven todos sus comercios a la vez. Sin esto seguirían
    // con lo anterior hasta que expirara la caché, cada uno por su lado.
    await Promise.all(affectedTenants.map((t) => this.entitlements?.invalidate(t.tenant_id)));
  }
}
