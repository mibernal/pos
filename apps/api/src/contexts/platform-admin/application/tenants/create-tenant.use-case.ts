import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { randomUUID } from 'crypto';
import { hashPassword } from '../../../identity/auth/password.js';
import { CreateTenantCommand } from '../../domain/platform-admin.types.js';

export class CreateTenantUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(payload: CreateTenantCommand, actorId: string, actorEmail: string) {
    const existingUser = await this.db.selectFrom('users').where('email', '=', payload.email).select('id').executeTakeFirst();
    if (existingUser) throw new AppError(400, 'BAD_REQUEST', 'El correo electrónico ya está registrado');

    const existingTenant = await this.db.selectFrom('tenants').where('nit', '=', payload.tenant_document_number).select('id').executeTakeFirst();
    if (existingTenant) throw new AppError(400, 'BAD_REQUEST', 'El documento del negocio ya está registrado');

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
      
      const planRow = await trx.selectFrom('billing_plans').where('name', '=', payload.plan).selectAll().executeTakeFirst();
      if (planRow) {
        await trx.insertInto('tenant_subscriptions').values({
          id: randomUUID(),
          tenant_id: tenantId,
          plan_id: planRow.id,
          status: 'ACTIVE',
          current_period_start: new Date(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          starts_at: new Date(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }).execute();
      }
    });

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_CREATED_ADMIN',
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { plan: payload.plan, tax_mode: payload.tax_mode } as any // eslint-disable-line @typescript-eslint/no-explicit-any
    }).execute();

    return tenantId;
  }
}
