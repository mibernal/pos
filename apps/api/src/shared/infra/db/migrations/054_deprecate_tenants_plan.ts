import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';

export async function up(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // 1. Migrar planes existentes a tenant_subscriptions si algún tenant no la tiene
  const tenantsWithoutSubs = await db.selectFrom('tenants')
    .leftJoin('tenant_subscriptions', 'tenant_subscriptions.tenant_id', 'tenants.id')
    .select(['tenants.id as tenant_id', 'tenants.plan', 'tenants.created_at'])
    .where('tenant_subscriptions.id', 'is', null)
    .execute();

  for (const tenant of tenantsWithoutSubs) {
    if (tenant.plan) {
      let mappedPlan = tenant.plan.toUpperCase();
      if (mappedPlan === 'BASIC') mappedPlan = 'STARTER';
      if (!['STARTER', 'PRO', 'ENTERPRISE'].includes(mappedPlan)) {
        mappedPlan = 'STARTER';
      }

      await db.insertInto('tenant_subscriptions').values({
        id: randomUUID(),
        tenant_id: tenant.tenant_id,
        plan_id: mappedPlan,
        status: 'TRIAL',
        current_period_start: tenant.created_at || new Date(),
        current_period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        starts_at: tenant.created_at || new Date(),
        created_at: new Date(),
        updated_at: new Date()
      }).execute();
    }
  }

  // 2. Eliminar la columna para imponer la Única Fuente de Verdad
  await db.schema.alterTable('tenants').dropColumn('plan').execute();
}

export async function down(db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Restaurar la columna (con valor default STARTER)
  await db.schema.alterTable('tenants').addColumn('plan', 'varchar(255)', (col) => col.defaultTo('STARTER')).execute();
  
  // Opcional: Volcar datos desde tenant_subscriptions hacia tenants.plan
  const subs = await db.selectFrom('tenant_subscriptions').select(['tenant_id', 'plan_id']).execute();
  for (const sub of subs) {
    await db.updateTable('tenants').set({ plan: sub.plan_id }).where('id', '=', sub.tenant_id).execute();
  }
}
