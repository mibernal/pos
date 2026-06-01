import { sql } from 'kysely';
import { createDb } from './connection.js';
import { hashPassword } from '../../../contexts/identity/auth/password.js';

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
      await sql`
        INSERT INTO user_branches (tenant_id, user_id, branch_id)
        VALUES
          (${demoIds.tenantId}, ${demoIds.adminUserId}, ${demoIds.branchId}),
          (${demoIds.tenantId}, ${demoIds.cashierUserId}, ${demoIds.branchId})
        ON CONFLICT DO NOTHING
      `.execute(trx);

      const terminalId = '55555555-5555-4555-8555-555555555555';
      await sql`
        INSERT INTO terminals (id, tenant_id, branch_id, name, is_active)
        VALUES (${terminalId}, ${demoIds.tenantId}, ${demoIds.branchId}, 'Caja Principal', TRUE)
        ON CONFLICT (tenant_id, branch_id, name) DO UPDATE SET is_active = EXCLUDED.is_active
      `.execute(trx);

      const products = [
        { id: '66666666-1111-4666-8666-666666666666', name: 'Café Americano', cat: 'Bebidas', tax: 'IVA_19', price: 2500, cost: 800 },
        { id: '66666666-2222-4666-8666-666666666666', name: 'Arepa de Queso', cat: 'Alimentos', tax: 'IVA_0', price: 3000, cost: 1200 },
        { id: '66666666-3333-4666-8666-666666666666', name: 'Empanada de Carne', cat: 'Alimentos', tax: 'IVA_5', price: 1500, cost: 600 },
        { id: '66666666-4444-4666-8666-666666666666', name: 'Gaseosa 500ml', cat: 'Bebidas', tax: 'IVA_19', price: 2000, cost: 1000 },
        { id: '66666666-5555-4666-8666-666666666666', name: 'Menú Ejecutivo', cat: 'Restaurante', tax: 'INC_8', price: 15000, cost: 6000 }
      ];

      for (const p of products) {
        await sql`
          INSERT INTO products (id, tenant_id, branch_id, name, category, tax_category, price_cents, cost_cents, active)
          VALUES (${p.id}, ${demoIds.tenantId}, ${demoIds.branchId}, ${p.name}, ${p.cat}, ${p.tax}, ${p.price}, ${p.cost}, TRUE)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name, price_cents = EXCLUDED.price_cents, cost_cents = EXCLUDED.cost_cents, tax_category = EXCLUDED.tax_category
        `.execute(trx);

        await sql`
          INSERT INTO inventory_balances (tenant_id, branch_id, product_id, variant_id, on_hand_qty)
          SELECT ${demoIds.tenantId}, ${demoIds.branchId}, ${p.id}, NULL, '100'
          WHERE NOT EXISTS (
            SELECT 1 FROM inventory_balances 
            WHERE tenant_id = ${demoIds.tenantId} AND branch_id = ${demoIds.branchId} AND product_id = ${p.id} AND variant_id IS NULL
          )
        `.execute(trx);
      }
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
