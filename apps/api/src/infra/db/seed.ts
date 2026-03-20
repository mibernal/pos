import { sql } from 'kysely';
import { createDb } from './connection.js';
import { hashPassword } from '../../auth/password.js';

const demoIds = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  adminUserId: '33333333-3333-4333-8333-333333333333',
  cashierUserId: '44444444-4444-4444-8444-444444444444'
} as const;

const demoCredentials = {
  adminEmail: 'admin@demo.posdian.local',
  adminPassword: 'Admin123*',
  cashierEmail: 'cashier@demo.posdian.local',
  cashierPassword: 'Cashier123*'
} as const;

async function runSeed(): Promise<void> {
  const db = createDb();

  try {
    const adminPasswordHash = await hashPassword(demoCredentials.adminPassword);
    const cashierPasswordHash = await hashPassword(demoCredentials.cashierPassword);

    await db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO tenants (id, name, nit, business_name, address, phone, footer_message)
        VALUES (
          ${demoIds.tenantId},
          'Demo Tenant',
          '900999111',
          'Demo Business S.A.S.',
          'Calle 123 #45-67, Bogotá',
          '6015550101',
          'Gracias por comprar en Demo Business S.A.S.'
        )
        ON CONFLICT (id) DO UPDATE
        SET
          name = EXCLUDED.name,
          nit = EXCLUDED.nit,
          business_name = EXCLUDED.business_name,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          footer_message = EXCLUDED.footer_message
      `.execute(trx);

      await sql`
        INSERT INTO branches (id, tenant_id, name, address)
        VALUES (${demoIds.branchId}, ${demoIds.tenantId}, 'Sucursal Demo', 'Calle 123 #45-67, Bogotá')
        ON CONFLICT (tenant_id, id) DO UPDATE
        SET
          name = EXCLUDED.name,
          address = EXCLUDED.address
      `.execute(trx);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, name, role, active)
        VALUES
          (
            ${demoIds.adminUserId},
            ${demoIds.tenantId},
            ${demoCredentials.adminEmail},
            ${adminPasswordHash},
            'Administrador Demo',
            'ADMIN',
            TRUE
          ),
          (
            ${demoIds.cashierUserId},
            ${demoIds.tenantId},
            ${demoCredentials.cashierEmail},
            ${cashierPasswordHash},
            'Cajero Demo',
            'CASHIER',
            TRUE
          )
        ON CONFLICT (tenant_id, email) DO UPDATE
        SET
          password_hash = EXCLUDED.password_hash,
          name = EXCLUDED.name,
          role = EXCLUDED.role,
          active = EXCLUDED.active
      `.execute(trx);
    });

    console.info('[seed] Demo tenant, branch y usuarios creados/actualizados');
    console.info(`[seed] Admin: ${demoCredentials.adminEmail} / ${demoCredentials.adminPassword}`);
    console.info(`[seed] Cashier: ${demoCredentials.cashierEmail} / ${demoCredentials.cashierPassword}`);
  } finally {
    await db.destroy();
  }
}

runSeed().catch((error) => {
  console.error('[seed] Failed to seed database', error);
  process.exit(1);
});
