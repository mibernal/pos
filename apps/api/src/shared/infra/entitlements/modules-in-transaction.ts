import type { Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { ASSIGNABLE_MODULES, type AssignableModule } from '@pos-dian/shared';

const MODULE_SET = new Set<string>(ASSIGNABLE_MODULES);

/**
 * Módulos vigentes de un comercio, leídos dentro de una transacción que ya está en su
 * contexto.
 *
 * `EntitlementsResolver` es lo que usa el ciclo de petición, pero abre su propia transacción
 * para leer los overrides y no sirve dentro de una que ya está en curso —como la que crea
 * una venta—. Sin esta función, el único camino que le quedaba a un servicio era leer las
 * columnas `enable_*` de `tenants`.
 *
 * Y eso es justo lo que la fase 7 dejó de ser verdad: esas columnas quedaron como vista de
 * compatibilidad que solo mantiene al día el alta por panel, así que un módulo concedido por
 * override —que es como la fase 7 dice que se conceden— no llegaba a verse. La creación de
 * ventas comprobaba propinas, domicilios y modificadores contra ellas, de modo que un
 * comercio con propinas concedidas recibía «Las propinas no están habilitadas».
 */
export async function modulesForTenantInTransaction(
  trx: Transaction<Database>,
  tenantId: string
): Promise<Set<AssignableModule>> {
  const now = new Date();

  const subscription = await trx
    .selectFrom('tenant_subscriptions')
    .select(['plan_id'])
    .where('tenant_id', '=', tenantId)
    .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
    .orderBy('created_at', 'desc')
    .executeTakeFirst();

  const planModules = subscription
    ? await trx.selectFrom('plan_modules').select('module').where('plan_id', '=', subscription.plan_id).execute()
    : [];

  const overrides = await trx
    .selectFrom('tenant_module_overrides')
    .select(['module', 'enabled'])
    .where('tenant_id', '=', tenantId)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .execute();

  const modules = new Set<string>(planModules.map((row) => row.module));

  for (const override of overrides) {
    if (override.enabled) modules.add(override.module);
    else modules.delete(override.module);
  }

  return new Set([...modules].filter((module): module is AssignableModule => MODULE_SET.has(module)));
}
