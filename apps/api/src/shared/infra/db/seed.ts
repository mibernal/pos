import { sql } from 'kysely';
import { createDb } from './connection.js';
import { hashPassword } from '../../../contexts/identity/auth/password.js';
import { Queue } from 'bullmq';
import { OUTBOX_QUEUE_NAME } from '@pos-dian/shared';
import { executeAsTenant } from './rls.js';
import { randomUUID } from 'crypto';

const demoIds = {
  tenant1Id: '11111111-1111-4111-8111-111111111111',
  tenant2Id: '11111111-2222-4222-8222-222222222222',
  tenant3Id: '11111111-3333-4333-8333-333333333333',
  tenant4Id: '11111111-4444-4444-8444-444444444444',

  // Tenant 1
  t1_branchMain: '22222222-2222-4222-8222-222222222222', // Was branchId
  t1_branchNorth: '22222222-1111-4222-8222-222222222222',
  t1_adminUser: '33333333-3333-4333-8333-333333333333', // Was adminUserId
  t1_cashierUser: '44444444-4444-4444-8444-444444444444', // Was cashierUserId
  t1_managerUser: '55555555-1111-4555-8555-555555555555',

  // Tenant 2
  t2_branchMain: '22222222-3333-4222-8222-333333333333',
  t2_adminUser: '33333333-2222-4333-8333-444444444444',
  t2_cashierUser: '44444444-2222-4444-8444-555555555555',

  // Tenant 3 (Pizzería)
  t3_branchMain: '22222222-4444-4333-8333-444444444444',
  t3_adminUser: '33333333-4444-4333-8333-555555555555',
  t3_managerUser: '44444444-4444-4333-8333-666666666666',
  t3_cashierUser: '55555555-4444-4333-8333-777777777777',

  // Tenant 4 (Sushi)
  t4_branchMain: '22222222-5555-4444-8444-555555555555',
  t4_adminUser: '33333333-5555-4444-8444-666666666666',
  t4_managerUser: '44444444-5555-4444-8444-777777777777',
  t4_cashierUser: '55555555-5555-4444-8444-888888888888',

  // Customers
  t1_customer1: '77777777-1111-4777-8777-111111111111',
  t1_customer2: '77777777-2222-4777-8777-222222222222',
} as const;

const demoCredentials = {
  t1_admin: 'admin@demo.posdian.local',
  t1_cashier: 'cashier@demo.posdian.local',
  t1_manager: 'manager@demo.posdian.local',
  t2_admin: 'admin2@demo.posdian.local',
  t2_cashier: 'cashier2@demo.posdian.local',
  t3_admin: 'admin3@demo.posdian.local',
  t3_manager: 'manager3@demo.posdian.local',
  t3_cashier: 'cashier3@demo.posdian.local',
  t4_admin: 'admin4@demo.posdian.local',
  t4_manager: 'manager4@demo.posdian.local',
  t4_cashier: 'cashier4@demo.posdian.local',
  p_owner: 'superadmin@demo.posdian.local',
  p_admin: 'platform_admin@demo.posdian.local'
} as const;

async function runSeed(): Promise<void> {
  const db = createDb();
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const queue = new Queue(OUTBOX_QUEUE_NAME, { connection: { url: redisUrl } });

  try {
    await queue.obliterate({ force: true });
    console.info('[seed] BullMQ queue drained');

    await sql`
      DELETE FROM outbox_events WHERE aggregate_id NOT IN (SELECT id FROM sales) AND type ILIKE '%sale%';
      DELETE FROM dian_documents WHERE sale_id NOT IN (SELECT id FROM sales);
    `.execute(db);
    console.info('[seed] Orphaned records cleaned');

    const defaultPassword = process.env.SEED_DEFAULT_PASSWORD;
    if (!defaultPassword) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SEED_DEFAULT_PASSWORD must be provided in production to avoid hardcoded credentials.');
      }
      console.warn('⚠️ SEED_DEFAULT_PASSWORD not provided. Falling back to insecure default for development.');
    }
    const finalPassword = defaultPassword || 'Password123*';
    const pwHash = await hashPassword(finalPassword);

    // ==========================================
    // PLATFORM: Administradores Globales
    // ==========================================
    await sql`DELETE FROM users WHERE tenant_id IS NULL;`.execute(db);
    await sql`
      INSERT INTO users (id, tenant_id, email, password_hash, name, role, active) VALUES
      (${randomUUID()}, NULL, ${demoCredentials.p_owner}, ${pwHash}, 'Super Admin', 'PLATFORM_OWNER', TRUE),
      (${randomUUID()}, NULL, ${demoCredentials.p_admin}, ${pwHash}, 'Platform Admin', 'PLATFORM_OWNER', TRUE)
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `.execute(db);

    // ==========================================
    // TENANT 1: Restaurante multi-sede
    // ==========================================
    await executeAsTenant(db, demoIds.tenant1Id, async (trx) => {
      await sql`
        INSERT INTO tenants (id, name, nit, business_name, address, phone, footer_message, status)
        VALUES (${demoIds.tenant1Id}, 'Demo Restaurant', '900111222', 'Demo Rest S.A.S.', 'Calle 100', '6011111', 'Gracias!', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
      `.execute(trx);

      await sql`DELETE FROM tenant_subscriptions WHERE tenant_id = ${demoIds.tenant1Id}`.execute(trx);
      await sql`
        INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, starts_at)
        VALUES (${randomUUID()}, ${demoIds.tenant1Id}, 'PRO', 'ACTIVE', now(), now() + interval '30 days', now())
      `.execute(trx);

      await sql`
        INSERT INTO branches (id, tenant_id, name, address) VALUES 
        (${demoIds.t1_branchMain}, ${demoIds.tenant1Id}, 'Sede Centro', 'Centro 123'),
        (${demoIds.t1_branchNorth}, ${demoIds.tenant1Id}, 'Sede Norte', 'Norte 456')
        ON CONFLICT (tenant_id, id) DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, name, role, active) VALUES
        (${demoIds.t1_adminUser}, ${demoIds.tenant1Id}, ${demoCredentials.t1_admin}, ${pwHash}, 'Admin T1', 'ADMIN', TRUE),
        (${demoIds.t1_managerUser}, ${demoIds.tenant1Id}, ${demoCredentials.t1_manager}, ${pwHash}, 'Gerente T1', 'MANAGER', TRUE),
        (${demoIds.t1_cashierUser}, ${demoIds.tenant1Id}, ${demoCredentials.t1_cashier}, ${pwHash}, 'Cajero T1', 'CASHIER', TRUE)
        ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `.execute(trx);

      await sql`
        INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES
        (${demoIds.tenant1Id}, ${demoIds.t1_adminUser}, ${demoIds.t1_branchMain}),
        (${demoIds.tenant1Id}, ${demoIds.t1_adminUser}, ${demoIds.t1_branchNorth}),
        (${demoIds.tenant1Id}, ${demoIds.t1_managerUser}, ${demoIds.t1_branchMain}),
        (${demoIds.tenant1Id}, ${demoIds.t1_cashierUser}, ${demoIds.t1_branchMain})
        ON CONFLICT DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO terminals (id, tenant_id, branch_id, name, is_active) VALUES 
        (${randomUUID()}, ${demoIds.tenant1Id}, ${demoIds.t1_branchMain}, 'Caja 1 Centro', TRUE),
        (${randomUUID()}, ${demoIds.tenant1Id}, ${demoIds.t1_branchNorth}, 'Caja 1 Norte', TRUE)
        ON CONFLICT (tenant_id, branch_id, name) DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO customers (id, tenant_id, document_type, document_number, name, email, phone) VALUES 
        (${demoIds.t1_customer1}, ${demoIds.tenant1Id}, 'CC', '1010101010', 'Juan Perez', 'juan@test.com', '3000000000'),
        (${demoIds.t1_customer2}, ${demoIds.tenant1Id}, 'NIT', '900888777', 'Empresa Cliente SAS', 'pagos@empresa.com', '3111111111')
        ON CONFLICT (tenant_id, document_type, document_number) DO NOTHING
      `.execute(trx);

      const t1Products = [
        { id: randomUUID(), name: 'Café', cat: 'Bebidas', tax: 'IVA_19', price: 5000, cost: 1000 },
        { id: randomUUID(), name: 'Hamburguesa', cat: 'Comida', tax: 'INC_8', price: 25000, cost: 8000 }
      ];

      for (const p of t1Products) {
        await sql`
          INSERT INTO products (id, tenant_id, name, category, tax_category, price_cents, cost_cents, active)
          VALUES (${p.id}, ${demoIds.tenant1Id}, ${p.name}, ${p.cat}, ${p.tax}, ${p.price}, ${p.cost}, TRUE)
          ON CONFLICT (id) DO NOTHING
        `.execute(trx);

        await sql`
          INSERT INTO inventory_balances (tenant_id, branch_id, product_id, on_hand_qty, version)
          VALUES 
          (${demoIds.tenant1Id}, ${demoIds.t1_branchMain}, ${p.id}, 100, 1),
          (${demoIds.tenant1Id}, ${demoIds.t1_branchNorth}, ${p.id}, 50, 1)
          ON CONFLICT DO NOTHING
        `.execute(trx);
      }
    });

    // ==========================================
    // TENANT 2: Retailer pequeña
    // ==========================================
    await executeAsTenant(db, demoIds.tenant2Id, async (trx) => {
      await sql`
        INSERT INTO tenants (id, name, nit, business_name, address, phone, footer_message, status)
        VALUES (${demoIds.tenant2Id}, 'Demo Retail', '900333444', 'Demo Retail S.A.S.', 'Cra 50', '6012222', 'Vuelva pronto!', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
      `.execute(trx);

      await sql`DELETE FROM tenant_subscriptions WHERE tenant_id = ${demoIds.tenant2Id}`.execute(trx);
      await sql`
        INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, starts_at)
        VALUES (${randomUUID()}, ${demoIds.tenant2Id}, 'STARTER', 'ACTIVE', now(), now() + interval '30 days', now())
      `.execute(trx);

      await sql`
        INSERT INTO branches (id, tenant_id, name, address) VALUES 
        (${demoIds.t2_branchMain}, ${demoIds.tenant2Id}, 'Local Único', 'Cra 50 #10')
        ON CONFLICT (tenant_id, id) DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, name, role, active) VALUES
        (${demoIds.t2_adminUser}, ${demoIds.tenant2Id}, ${demoCredentials.t2_admin}, ${pwHash}, 'Admin T2', 'ADMIN', TRUE),
        (${demoIds.t2_cashierUser}, ${demoIds.tenant2Id}, ${demoCredentials.t2_cashier}, ${pwHash}, 'Cajero T2', 'CASHIER', TRUE)
        ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `.execute(trx);

      await sql`
        INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES
        (${demoIds.tenant2Id}, ${demoIds.t2_adminUser}, ${demoIds.t2_branchMain}),
        (${demoIds.tenant2Id}, ${demoIds.t2_cashierUser}, ${demoIds.t2_branchMain})
        ON CONFLICT DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO terminals (id, tenant_id, branch_id, name, is_active) VALUES 
        (${randomUUID()}, ${demoIds.tenant2Id}, ${demoIds.t2_branchMain}, 'Caja Única', TRUE)
        ON CONFLICT (tenant_id, branch_id, name) DO NOTHING
      `.execute(trx);

      const t2Products = [
        { id: randomUUID(), name: 'Camiseta Blanca', cat: 'Ropa', tax: 'IVA_19', price: 45000, cost: 20000 },
        { id: randomUUID(), name: 'Gorra Negra', cat: 'Accesorios', tax: 'IVA_19', price: 30000, cost: 10000 }
      ];

      for (const p of t2Products) {
        await sql`
          INSERT INTO products (id, tenant_id, name, category, tax_category, price_cents, cost_cents, active)
          VALUES (${p.id}, ${demoIds.tenant2Id}, ${p.name}, ${p.cat}, ${p.tax}, ${p.price}, ${p.cost}, TRUE)
          ON CONFLICT (id) DO NOTHING
        `.execute(trx);

        await sql`
          INSERT INTO inventory_balances (tenant_id, branch_id, product_id, on_hand_qty, version)
          VALUES (${demoIds.tenant2Id}, ${demoIds.t2_branchMain}, ${p.id}, 10, 1)
          ON CONFLICT DO NOTHING
        `.execute(trx);
      }
    });

    // ==========================================
    // TENANT 3: Pizzería
    // ==========================================
    await executeAsTenant(db, demoIds.tenant3Id, async (trx) => {
      await sql`
        INSERT INTO tenants (id, name, nit, business_name, address, phone, footer_message, status)
        VALUES (${demoIds.tenant3Id}, 'Pizzería Napoli', '900555666', 'Napoli S.A.S.', 'Av. Siempre Viva 123', '6013333', '¡Gracias por su compra!', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
      `.execute(trx);

      await sql`DELETE FROM tenant_subscriptions WHERE tenant_id = ${demoIds.tenant3Id}`.execute(trx);
      await sql`
        INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, starts_at)
        VALUES (${randomUUID()}, ${demoIds.tenant3Id}, 'PRO', 'ACTIVE', now(), now() + interval '30 days', now())
      `.execute(trx);

      // Rename old branches and users to avoid unique constraint violations without breaking foreign keys (like cash_sessions)
      await sql`UPDATE branches SET name = 'Old ' || substr(id::text, 1, 8) WHERE tenant_id = ${demoIds.tenant3Id} AND id != ${demoIds.t3_branchMain}`.execute(trx);
      await sql`UPDATE users SET email = 'old_' || substr(id::text, 1, 8) || '_' || email WHERE tenant_id = ${demoIds.tenant3Id} AND id NOT IN (${demoIds.t3_adminUser}, ${demoIds.t3_managerUser}, ${demoIds.t3_cashierUser})`.execute(trx);

      await sql`
        INSERT INTO branches (id, tenant_id, name, address) VALUES 
        (${demoIds.t3_branchMain}, ${demoIds.tenant3Id}, 'Sede Principal', 'Av. Siempre Viva 123')
        ON CONFLICT (tenant_id, id) DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, name, role, active) VALUES
        (${demoIds.t3_adminUser}, ${demoIds.tenant3Id}, ${demoCredentials.t3_admin}, ${pwHash}, 'Admin Pizzería', 'ADMIN', TRUE),
        (${demoIds.t3_managerUser}, ${demoIds.tenant3Id}, ${demoCredentials.t3_manager}, ${pwHash}, 'Gerente Pizzería', 'MANAGER', TRUE),
        (${demoIds.t3_cashierUser}, ${demoIds.tenant3Id}, ${demoCredentials.t3_cashier}, ${pwHash}, 'Cajero Pizzería', 'CASHIER', TRUE)
        ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `.execute(trx);

      await sql`
        INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES
        (${demoIds.tenant3Id}, ${demoIds.t3_adminUser}, ${demoIds.t3_branchMain}),
        (${demoIds.tenant3Id}, ${demoIds.t3_managerUser}, ${demoIds.t3_branchMain}),
        (${demoIds.tenant3Id}, ${demoIds.t3_cashierUser}, ${demoIds.t3_branchMain})
        ON CONFLICT DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO terminals (id, tenant_id, branch_id, name, is_active) VALUES 
        (${randomUUID()}, ${demoIds.tenant3Id}, ${demoIds.t3_branchMain}, 'Caja 1', TRUE)
        ON CONFLICT (tenant_id, branch_id, name) DO NOTHING
      `.execute(trx);

      const t3Products = [
        { id: randomUUID(), name: 'Pizza Margarita', cat: 'Platos Fuertes', tax: 'INC_8', price: 35000, cost: 12000 },
        { id: randomUUID(), name: 'Pizza Pepperoni', cat: 'Platos Fuertes', tax: 'INC_8', price: 42000, cost: 15000 },
        { id: randomUUID(), name: 'Pizza Hawaiana', cat: 'Platos Fuertes', tax: 'INC_8', price: 38000, cost: 13000 },
        { id: randomUUID(), name: 'Lasagna', cat: 'Platos Fuertes', tax: 'INC_8', price: 28000, cost: 9000 },
        { id: randomUUID(), name: 'Pan de Ajo', cat: 'Entradas', tax: 'INC_8', price: 12000, cost: 3000 },
        { id: randomUUID(), name: 'Dedos de Queso', cat: 'Entradas', tax: 'INC_8', price: 15000, cost: 4500 },
        { id: randomUUID(), name: 'Tiramisú', cat: 'Postres', tax: 'INC_8', price: 18000, cost: 5000 },
        { id: randomUUID(), name: 'Coca Cola 400ml', cat: 'Bebidas', tax: 'IVA_19', price: 5000, cost: 2000 },
        { id: randomUUID(), name: 'Cerveza Artesanal', cat: 'Bebidas', tax: 'IVA_19', price: 12000, cost: 6000 },
        { id: randomUUID(), name: 'Salsa de Ajo extra', cat: 'Adicionales', tax: 'INC_8', price: 3000, cost: 500 }
      ];

      for (const p of t3Products) {
        await sql`
          INSERT INTO products (id, tenant_id, name, category, tax_category, price_cents, cost_cents, active)
          VALUES (${p.id}, ${demoIds.tenant3Id}, ${p.name}, ${p.cat}, ${p.tax}, ${p.price}, ${p.cost}, TRUE)
          ON CONFLICT (id) DO NOTHING
        `.execute(trx);

        await sql`
          INSERT INTO inventory_balances (tenant_id, branch_id, product_id, on_hand_qty, version)
          VALUES (${demoIds.tenant3Id}, ${demoIds.t3_branchMain}, ${p.id}, 50, 1)
          ON CONFLICT DO NOTHING
        `.execute(trx);
      }
    });

    // ==========================================
    // TENANT 4: Sushi
    // ==========================================
    await executeAsTenant(db, demoIds.tenant4Id, async (trx) => {
      await sql`
        INSERT INTO tenants (id, name, nit, business_name, address, phone, footer_message, status)
        VALUES (${demoIds.tenant4Id}, 'Tokyo Sushi', '900777888', 'Tokyo Sushi S.A.S.', 'Calle 85 # 15', '6014444', 'Arigato!', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status
      `.execute(trx);

      await sql`DELETE FROM tenant_subscriptions WHERE tenant_id = ${demoIds.tenant4Id}`.execute(trx);
      await sql`
        INSERT INTO tenant_subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end, starts_at)
        VALUES (${randomUUID()}, ${demoIds.tenant4Id}, 'PRO', 'ACTIVE', now(), now() + interval '30 days', now())
      `.execute(trx);

      // Rename old branches and users to avoid unique constraint violations without breaking foreign keys
      await sql`UPDATE branches SET name = 'Old ' || substr(id::text, 1, 8) WHERE tenant_id = ${demoIds.tenant4Id} AND id != ${demoIds.t4_branchMain}`.execute(trx);
      await sql`UPDATE users SET email = 'old_' || substr(id::text, 1, 8) || '_' || email WHERE tenant_id = ${demoIds.tenant4Id} AND id NOT IN (${demoIds.t4_adminUser}, ${demoIds.t4_managerUser}, ${demoIds.t4_cashierUser})`.execute(trx);

      await sql`
        INSERT INTO branches (id, tenant_id, name, address) VALUES 
        (${demoIds.t4_branchMain}, ${demoIds.tenant4Id}, 'Sede Zona T', 'Calle 85 # 15')
        ON CONFLICT (tenant_id, id) DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO users (id, tenant_id, email, password_hash, name, role, active) VALUES
        (${demoIds.t4_adminUser}, ${demoIds.tenant4Id}, ${demoCredentials.t4_admin}, ${pwHash}, 'Admin Sushi', 'ADMIN', TRUE),
        (${demoIds.t4_managerUser}, ${demoIds.tenant4Id}, ${demoCredentials.t4_manager}, ${pwHash}, 'Gerente Sushi', 'MANAGER', TRUE),
        (${demoIds.t4_cashierUser}, ${demoIds.tenant4Id}, ${demoCredentials.t4_cashier}, ${pwHash}, 'Cajero Sushi', 'CASHIER', TRUE)
        ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
      `.execute(trx);

      await sql`
        INSERT INTO user_branches (tenant_id, user_id, branch_id) VALUES
        (${demoIds.tenant4Id}, ${demoIds.t4_adminUser}, ${demoIds.t4_branchMain}),
        (${demoIds.tenant4Id}, ${demoIds.t4_managerUser}, ${demoIds.t4_branchMain}),
        (${demoIds.tenant4Id}, ${demoIds.t4_cashierUser}, ${demoIds.t4_branchMain})
        ON CONFLICT DO NOTHING
      `.execute(trx);

      await sql`
        INSERT INTO terminals (id, tenant_id, branch_id, name, is_active) VALUES 
        (${randomUUID()}, ${demoIds.tenant4Id}, ${demoIds.t4_branchMain}, 'Caja Principal', TRUE)
        ON CONFLICT (tenant_id, branch_id, name) DO NOTHING
      `.execute(trx);

      const t4Products = [
        { id: randomUUID(), name: 'Roll Philadelphia (10 bites)', cat: 'Platos Fuertes', tax: 'INC_8', price: 25000, cost: 9000 },
        { id: randomUUID(), name: 'Roll Ojo de Tigre (10 bites)', cat: 'Platos Fuertes', tax: 'INC_8', price: 28000, cost: 11000 },
        { id: randomUUID(), name: 'Nigiri Salmón (2 pzs)', cat: 'Entradas', tax: 'INC_8', price: 12000, cost: 4000 },
        { id: randomUUID(), name: 'Gyozas Cerdo (5 pzs)', cat: 'Entradas', tax: 'INC_8', price: 16000, cost: 5000 },
        { id: randomUUID(), name: 'Edamame', cat: 'Entradas', tax: 'INC_8', price: 10000, cost: 3000 },
        { id: randomUUID(), name: 'Mochi Helado', cat: 'Postres', tax: 'INC_8', price: 15000, cost: 6000 },
        { id: randomUUID(), name: 'Limonada de Coco', cat: 'Bebidas', tax: 'INC_8', price: 12000, cost: 3000 },
        { id: randomUUID(), name: 'Sake (Botella)', cat: 'Bebidas', tax: 'INC_8', price: 80000, cost: 35000 },
        { id: randomUUID(), name: 'Salsa Anguila extra', cat: 'Adicionales', tax: 'INC_8', price: 4000, cost: 1000 },
        { id: randomUUID(), name: 'Promo 2x1 Rolls', cat: 'Promociones', tax: 'INC_8', price: 40000, cost: 18000 }
      ];

      for (const p of t4Products) {
        await sql`
          INSERT INTO products (id, tenant_id, name, category, tax_category, price_cents, cost_cents, active)
          VALUES (${p.id}, ${demoIds.tenant4Id}, ${p.name}, ${p.cat}, ${p.tax}, ${p.price}, ${p.cost}, TRUE)
          ON CONFLICT (id) DO NOTHING
        `.execute(trx);

        await sql`
          INSERT INTO inventory_balances (tenant_id, branch_id, product_id, on_hand_qty, version)
          VALUES (${demoIds.tenant4Id}, ${demoIds.t4_branchMain}, ${p.id}, 50, 1)
          ON CONFLICT DO NOTHING
        `.execute(trx);
      }
    });

    console.info('==========================================');
    console.info('[seed] SEED EXITOSO!');
    console.info('==========================================');
    console.info('PLATAFORMA (Global Backoffice):');
    console.info(`- Owner:   ${demoCredentials.p_owner} / [PROTECTED]`);
    console.info(`- Admin:   ${demoCredentials.p_admin} / [PROTECTED]`);
    console.info('');
    console.info('TENANT 1 (Restaurante Multi-Sede):');
    console.info(`- Admin:   ${demoCredentials.t1_admin} / [PROTECTED]`);
    console.info(`- Manager: ${demoCredentials.t1_manager} / [PROTECTED]`);
    console.info(`- Cashier: ${demoCredentials.t1_cashier} / [PROTECTED]`);
    console.info('');
    console.info('TENANT 2 (Retail Básico):');
    console.info(`- Admin:   ${demoCredentials.t2_admin} / [PROTECTED]`);
    console.info(`- Cashier: ${demoCredentials.t2_cashier} / [PROTECTED]`);
    console.info('');
    console.info('TENANT 3 (Pizzería Napoli):');
    console.info(`- Admin:   ${demoCredentials.t3_admin} / [PROTECTED]`);
    console.info(`- Manager: ${demoCredentials.t3_manager} / [PROTECTED]`);
    console.info(`- Cashier: ${demoCredentials.t3_cashier} / [PROTECTED]`);
    console.info('');
    console.info('TENANT 4 (Tokyo Sushi):');
    console.info(`- Admin:   ${demoCredentials.t4_admin} / [PROTECTED]`);
    console.info(`- Manager: ${demoCredentials.t4_manager} / [PROTECTED]`);
    console.info(`- Cashier: ${demoCredentials.t4_cashier} / [PROTECTED]`);
    console.info('==========================================');

  } finally {
    await queue.close();
    await db.destroy();
  }
}

runSeed().catch((error) => {
  console.error('[seed] Failed to seed database', error);
  process.exit(1);
});
