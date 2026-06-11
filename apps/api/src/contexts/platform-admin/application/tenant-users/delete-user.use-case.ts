import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

export class DeleteUserUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, userId: string, actorId: string, actorEmail: string) {
    const user = await this.db.selectFrom('users').where('id', '=', userId).where('tenant_id', '=', tenantId).selectAll().executeTakeFirst();
    if (!user) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

    const tenant = await this.db.selectFrom('tenants').where('id', '=', tenantId).selectAll().executeTakeFirst();
    if (tenant?.owner_user_id === userId) {
      throw new AppError(400, 'BAD_REQUEST', 'No puedes eliminar al usuario principal (dueño) de la cuenta');
    }

    await this.db.deleteFrom('users')
      .where('id', '=', userId)
      .where('tenant_id', '=', tenantId)
      .execute();

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_USER_DELETED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'WARNING',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { userId, email: user.email }
    }).execute();
  }
}
