import type { Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { ASSIGNABLE_MODULES, MODULE_COLUMN, type AssignableModule } from '@pos-dian/shared';

/**
 * Deja los módulos de un comercio exactamente en el estado pedido.
 *
 * Desde la fase 7 los módulos salen del plan; lo que un comercio tenga **por encima o por
 * debajo** de su plan es una excepción comercial, y una excepción tiene que estar escrita
 * con su motivo. Por eso esto no escribe un booleano y ya: compara contra lo que el plan
 * incluye y guarda un override solo donde hay diferencia. Si el comercio vuelve a coincidir
 * con su plan, el override se borra en vez de quedarse ahí contradiciendo al catálogo.
 *
 * Las 21 columnas de `tenants` se siguen escribiendo como vista de compatibilidad —hay
 * consultas y semillas que las leen— pero ya no son la fuente de verdad. El resolutor no
 * las mira.
 */
export async function applyTenantModules(
  trx: Transaction<Database>,
  tenantId: string,
  desired: Partial<Record<AssignableModule, boolean>>,
  reason: string
): Promise<void> {
  const subscription = await trx
    .selectFrom('tenant_subscriptions')
    .select('plan_id')
    .where('tenant_id', '=', tenantId)
    .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
    .orderBy('created_at', 'desc')
    .executeTakeFirst();

  const planModules = subscription
    ? new Set(
        (
          await trx
            .selectFrom('plan_modules')
            .select('module')
            .where('plan_id', '=', subscription.plan_id)
            .execute()
        ).map((row) => row.module)
      )
    : new Set<string>();

  const columnUpdate: Record<string, boolean> = {};

  for (const module of ASSIGNABLE_MODULES) {
    const wanted = desired[module];
    if (wanted === undefined) continue;

    const includedInPlan = planModules.has(module);
    columnUpdate[MODULE_COLUMN[module]] = wanted;

    if (wanted === includedInPlan) {
      // Coincide con el plan: no hace falta excepción, y si había una, sobra.
      await trx
        .deleteFrom('tenant_module_overrides')
        .where('tenant_id', '=', tenantId)
        .where('module', '=', module)
        .execute();
      continue;
    }

    await trx
      .insertInto('tenant_module_overrides')
      .values({ tenant_id: tenantId, module, enabled: wanted, reason, expires_at: null })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'module']).doUpdateSet({ enabled: wanted, reason, expires_at: null })
      )
      .execute();
  }

  if (Object.keys(columnUpdate).length > 0) {
    await trx
      .updateTable('tenants')
      .set(columnUpdate as never)
      .where('id', '=', tenantId)
      .execute();
  }
}
