import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { hashPassword } from '../../../identity/auth/password.js';
import { randomUUID } from 'crypto';
import { CreateTenantUserCommand } from '../../domain/platform-admin.types.js';

export class CreateUserUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  async execute(tenantId: string, payload: CreateTenantUserCommand, actorId: string, actorEmail: string) {
    const passwordHash = await hashPassword(payload.password ?? 'Password123*');
    const newUserId = randomUUID();

    const createdUser = await this.db.insertInto('users').values({
      id: newUserId,
      tenant_id: tenantId,
      email: payload.email,
      password_hash: passwordHash,
      name: payload.name,
      role: payload.role,
      active: payload.active
    }).returning(['id', 'email', 'name', 'role', 'active', 'created_at']).executeTakeFirstOrThrow();

    await this.db.insertInto('platform_events').values({
      tenant_id: tenantId,
      type: 'TENANT_USER_CREATED' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      severity: 'INFO',
      actor_id: actorId,
      actor_email: actorEmail,
      metadata: { userId: newUserId, email: payload.email, role: payload.role }
    }).execute();

    return createdUser;
  }
}
