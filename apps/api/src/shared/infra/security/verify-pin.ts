import { Kysely } from 'kysely';
import { Database } from '../db/schema.js';
import { verifyPassword } from '../../../contexts/identity/auth/password.js';

export async function verifyApprovalPin(
  db: Kysely<Database>,
  tenantId: string,
  rawPin: string
): Promise<string | null> {
  // Encontramos todos los usuarios del tenant que tengan roles altos
  // (En el futuro esto puede refinar buscando en una tabla JSON de permisos,
  // pero los roles PLATFORM_OWNER, TENANT_OWNER, ADMIN, MANAGER tienen autorización).
  const candidateUsers = await db
    .selectFrom('users')
    .select(['id', 'pin_hash'])
    .where('tenant_id', '=', tenantId)
    .where('active', '=', true)
    .where('pin_hash', 'is not', null)
    .where('role', 'in', ['PLATFORM_OWNER', 'TENANT_OWNER', 'ADMIN', 'MANAGER'])
    .execute();

  for (const user of candidateUsers) {
    if (user.pin_hash) {
      const isValid = await verifyPassword(rawPin, user.pin_hash);
      if (isValid) {
        return user.id;
      }
    }
  }

  return null;
}
