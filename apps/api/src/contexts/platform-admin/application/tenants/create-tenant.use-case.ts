import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';
import { hashPassword } from '../../../identity/auth/password.js';
import { CreateTenantCommand } from '../../domain/platform-admin.types.js';
import { resolveBillingPlan, periodDaysForCycle } from '../billing-plans/resolve-plan.js';

export class CreateTenantUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(payload: CreateTenantCommand, actorId: string, actorEmail: string) {
    const existingUser = await this.db.selectFrom('users').where('email', '=', payload.email).select('id').executeTakeFirst();
    if (existingUser) throw new AppError(400, 'BAD_REQUEST', 'El correo electrónico ya está registrado');

    const existingTenant = await this.db.selectFrom('tenants').where('nit', '=', payload.tenant_document_number).select('id').executeTakeFirst();
    if (existingTenant) throw new AppError(400, 'BAD_REQUEST', 'El documento del negocio ya está registrado');

    // El plan se resuelve **antes** de abrir la transacción: si la referencia no existe,
    // el alta se rechaza con 400 en vez de crear un comercio sin suscripción.
    const plan = await resolveBillingPlan(this.db, payload.plan);

    const passwordHash = await hashPassword(payload.password ?? 'Password123*');
    const tenantId = randomUUID();
    const userId = randomUUID();

    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('tenants').values({
        id: tenantId,
        name: payload.tenant_name,
        business_name: payload.tenant_business_name,
        nit: payload.tenant_document_number,
        address: 'No especificada',
        tax_mode: payload.tax_mode,
        business_type: payload.business_type ?? 'OTHER',
        custom_business_type: payload.business_type === 'OTHER' ? (payload.custom_business_type ?? null) : null,
        enable_tables: payload.business_type === 'OTHER' ? (payload.enable_tables ?? false) : ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_delivery: payload.enable_delivery ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_waiters: payload.enable_waiters ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_split_bill: payload.enable_split_bill ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_tips: payload.enable_tips ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_kitchen: payload.enable_kitchen ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_kitchen_display: payload.enable_kitchen_display ?? false,
        enable_kitchen_tickets: payload.enable_kitchen_tickets ?? ['RESTAURANT','CAFETERIA','BAR','NIGHTCLUB'].includes(payload.business_type || ''),
        enable_kitchen_printing: payload.enable_kitchen_printing ?? false,
        enable_order_rounds: payload.enable_order_rounds ?? false,
        enable_product_modifiers: payload.enable_product_modifiers ?? false,
        enable_reservations: payload.enable_reservations ?? false,
        enable_waiter_shifts: payload.enable_waiter_shifts ?? false,
        enable_qr_menu: payload.enable_qr_menu ?? false,
        status: 'ACTIVE',
        owner_user_id: userId
      }).execute();

      await trx.insertInto('users').values({
        id: userId,
        tenant_id: tenantId,
        email: payload.email,
        password_hash: passwordHash,
        name: payload.name,
        role: 'TENANT_OWNER',
        active: true
      }).execute();

      const branchId = randomUUID();
      await trx.insertInto('branches').values({
        id: branchId,
        tenant_id: tenantId,
        name: 'Sucursal Principal',
        address: 'No especificada'
      }).execute();

      await trx.insertInto('user_branches').values({
        tenant_id: tenantId,
        user_id: userId,
        branch_id: branchId
      }).execute();
      
      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + periodDaysForCycle(plan.billing_cycle));

      await trx.insertInto('tenant_subscriptions').values({
        id: randomUUID(),
        tenant_id: tenantId,
        plan_id: plan.id,
        status: 'ACTIVE',
        current_period_start: periodStart,
        current_period_end: periodEnd,
        starts_at: periodStart,
        expires_at: periodEnd
      }).execute();
    });

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_CREATED_ADMIN',
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { plan: plan.id, tax_mode: payload.tax_mode } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return tenantId;
  }
}
