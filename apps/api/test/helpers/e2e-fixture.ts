import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { executeAsTenant } from '../../src/shared/infra/db/rls.js';
import { Pool } from 'pg';
import { hashPassword } from '../../src/contexts/identity/auth/password.js';
import type { Database, ProductTaxCategory, TenantTaxMode } from '../../src/shared/infra/db/schema.js';
import { PaymentMethodsRepository } from '../../src/contexts/sales/infra/payment-methods.repository.js';

const adminPassword = 'Admin123*';
const cashierPassword = 'Cashier123*';

let adminPasswordHashPromise: Promise<string> | null = null;
let cashierPasswordHashPromise: Promise<string> | null = null;

function getAdminPasswordHash(): Promise<string> {
  adminPasswordHashPromise ??= hashPassword(adminPassword);
  return adminPasswordHashPromise;
}

function getCashierPasswordHash(): Promise<string> {
  cashierPasswordHashPromise ??= hashPassword(cashierPassword);
  return cashierPasswordHashPromise;
}

export interface E2eFixture {
  tenantId: string;
  branchId: string;
  terminalId: string;
  adminUserId: string;
  cashierUserId: string;
  productId: string;
  adminEmail: string;
  cashierEmail: string;
  adminPassword: string;
  cashierPassword: string;
  productPriceCents: number;
}

let schemaReadyPromise: Promise<void> | null = null;

/**
 * Conexión administrativa para preparar y limpiar datos de prueba.
 *
 * La app bajo prueba se conecta con un rol SIN BYPASSRLS —es el punto de la fase 2—, así
 * que no puede sembrar filas fuera de un contexto de tenant. Sembrar y limpiar son
 * operaciones de administración, igual que en un despliegue real, y usan el rol dueño.
 */
function createAdminDb(): Kysely<Database> {
  const connectionString = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 4 }) })
  });
}

let sharedAdminDb: Kysely<Database> | null = null;

/**
 * Conexión administrativa compartida para sembrar, limpiar y para las aserciones que
 * consultan la base directamente. El aislamiento se verifica en pruebas dedicadas que sí
 * pasan por la conexión de la app (ver `readAsTenant` y cross-tenant-isolation).
 */
export function adminDb(): Kysely<Database> {
  sharedAdminDb ??= createAdminDb();
  return sharedAdminDb;
}

export async function closeAdminDb(): Promise<void> {
  if (sharedAdminDb) {
    await sharedAdminDb.destroy();
    sharedAdminDb = null;
  }
}

/**
 * Verifica que la base de pruebas tenga el esquema migrado.
 *
 * Antes esta función parcheaba el esquema con 33 `ALTER TABLE ... IF NOT EXISTS`, porque
 * correr las migraciones de verdad no funcionaba (la 027 fallaba en cualquier base nueva).
 * El resultado era un esquema de test que divergía del real por diseño: las pruebas podían
 * pasar con migraciones rotas. Corregida la 027, lo correcto es exigir el esquema migrado
 * y fallar con un mensaje claro si no lo está.
 */
export function ensureE2eSchema(): Promise<void> {
  schemaReadyPromise ??= (async () => {
    const db = adminDb();

    try {
      const applied = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM kysely_migration
      `.execute(db).then((result) => Number(result.rows[0]?.count ?? 0)).catch(() => 0);

      if (applied === 0) {
        throw new Error(
          'La base de pruebas no tiene el esquema migrado. Ejecuta:\n' +
            '  pnpm --filter @pos-dian/api db:migrate'
        );
      }
    } catch (error) {
      schemaReadyPromise = null;
      throw error;
    }
  })();

  return schemaReadyPromise;
}

/**
 * Lee la base como lo haría la app: con el rol restringido y el contexto de tenant fijado.
 *
 * Las aserciones que consultan la base directamente tienen que pasar por aquí. Si usaran
 * una conexión con BYPASSRLS verían filas que la app no puede ver, y una regresión de
 * aislamiento pasaría desapercibida justo en las pruebas escritas para detectarla.
 */
export async function readAsTenant<T>(
  app: FastifyInstance,
  tenantId: string,
  read: (trx: Transaction<Database>) => Promise<T>
): Promise<T> {
  return executeAsTenant(app.db, tenantId, read);
}

export async function seedE2eFixture(
  app: FastifyInstance,
  options?: {
    taxMode?: TenantTaxMode;
    productTaxCategory?: ProductTaxCategory;
    productPriceCents?: number;
  }
): Promise<E2eFixture> {
  const suffix = randomUUID();
  const tenantId = randomUUID();
  const branchId = randomUUID();
  const terminalId = randomUUID();
  const adminUserId = randomUUID();
  const cashierUserId = randomUUID();
  const productId = randomUUID();
  const taxMode = options?.taxMode ?? 'IVA';
  const productTaxCategory = options?.productTaxCategory ?? 'IVA_19';
  const productPriceCents = options?.productPriceCents ?? 11900;
  const adminPasswordHash = await getAdminPasswordHash();
  const cashierPasswordHash = await getCashierPasswordHash();

  await adminDb().transaction().execute(async (trx) => {
    await trx
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: `Tenant E2E ${suffix}`,
        nit: suffix.slice(0, 10).replaceAll('-', ''),
        business_name: 'Negocio E2E SAS',
        address: 'Calle 10 # 20-30',
        phone: '6012345678',
        footer_message: 'Gracias por comprar en Negocio E2E SAS',
        tax_mode: taxMode
      })
      .execute();

    await trx
      .insertInto('tenant_subscriptions')
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        plan_id: 'STARTER',
        status: 'ACTIVE',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        starts_at: new Date()
      })
      .execute();

    // Sin catálogo, una venta con Nequi o fiado se rechaza: el comercio de prueba tiene que

    // nacer igual que uno real.

    await PaymentMethodsRepository.seedDefaults(trx, tenantId);


    await trx
      .insertInto('branches')
      .values({
        id: branchId,
        tenant_id: tenantId,
        name: 'Sucursal E2E',
        address: 'Calle 10 # 20-30'
      })
      .execute();

    await trx
      .insertInto('terminals')
      .values({
        id: terminalId,
        tenant_id: tenantId,
        branch_id: branchId,
        name: 'Caja E2E'
      })
      .execute();

    await trx
      .insertInto('users')
      .values([
        {
          id: adminUserId,
          tenant_id: tenantId,
          email: `admin.${suffix}@e2e.posdian.local`,
          password_hash: adminPasswordHash,
          name: 'Admin E2E',
          role: 'ADMIN',
          active: true
        },
        {
          id: cashierUserId,
          tenant_id: tenantId,
          email: `cashier.${suffix}@e2e.posdian.local`,
          password_hash: cashierPasswordHash,
          name: 'Cashier E2E',
          role: 'CASHIER',
          active: true
        }
      ])
      .execute();

    await trx
      .insertInto('user_branches')
      .values([
        { tenant_id: tenantId, user_id: adminUserId, branch_id: branchId },
        { tenant_id: tenantId, user_id: cashierUserId, branch_id: branchId }
      ])
      .execute();

    await trx
      .insertInto('products')
      .values({
        id: productId,
        tenant_id: tenantId,
        branch_id: branchId,
        name: 'Producto E2E',
        category: 'General',
        tax_category: productTaxCategory,
        barcode: `770${suffix.slice(0, 8).replaceAll('-', '')}`,
        price_cents: productPriceCents,
        cost_cents: 0,
        active: true
      })
      .execute();
  });

  return {
    tenantId,
    branchId,
    terminalId,
    adminUserId,
    cashierUserId,
    productId,
    adminEmail: `admin.${suffix}@e2e.posdian.local`,
    cashierEmail: `cashier.${suffix}@e2e.posdian.local`,
    adminPassword,
    cashierPassword,
    productPriceCents
  };
}

export async function cleanupE2eFixture(
  app: FastifyInstance,
  fixture: Pick<E2eFixture, 'tenantId'>
): Promise<void> {
  await adminDb().transaction().execute(async (trx) => {
    await sql`ALTER TABLE inventory_ledger DISABLE TRIGGER USER`.execute(trx);
    await sql`ALTER TABLE sales_ledger DISABLE TRIGGER USER`.execute(trx);
    await sql`ALTER TABLE cash_ledger DISABLE TRIGGER USER`.execute(trx);

    await trx.deleteFrom('inventory_ledger').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sales_ledger').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('cash_ledger').where('tenant_id', '=', fixture.tenantId).execute();

    await trx.deleteFrom('audit_logs').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('outbox_events').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('dian_documents').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('return_items').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sale_returns').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sale_items').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sales').where('tenant_id', '=', fixture.tenantId).execute();

    await sql`ALTER TABLE inventory_ledger ENABLE TRIGGER USER`.execute(trx);
    await sql`ALTER TABLE sales_ledger ENABLE TRIGGER USER`.execute(trx);
    await sql`ALTER TABLE cash_ledger ENABLE TRIGGER USER`.execute(trx);
    await trx.deleteFrom('cash_movements').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('cash_session_audits').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('cash_sessions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('inventory_transactions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('inventory_balances').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('promotions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('product_variants').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('products').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('user_branches').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('users').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('terminals').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('branches').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('tenant_subscriptions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('tenants').where('id', '=', fixture.tenantId).execute();
  });
}

export async function loginE2eUser(
  app: FastifyInstance,
  credentials: {
    email: string;
    password: string;
  }
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: credentials
  });

  if (response.statusCode !== 200) {
    throw new Error(`No fue posible hacer login en e2e: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as {
    accessToken: string;
  };

  return body.accessToken;
}

export function bearerHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`
  };
}

/**
 * Concede módulos a un comercio de prueba.
 *
 * Desde la fase 7 los módulos salen del plan, así que encender la columna booleana de
 * `tenants` ya no habilita nada: el resolutor no la mira. Una prueba que quiera un módulo
 * lo pide como excepción, que es exactamente el camino que usa el panel de plataforma.
 */
export async function grantModules(
  tenantId: string,
  modules: ReadonlyArray<import('@pos-dian/shared').AssignableModule>
): Promise<void> {
  if (modules.length === 0) return;

  await adminDb()
    .insertInto('tenant_module_overrides')
    .values(
      modules.map((module) => ({
        tenant_id: tenantId,
        module,
        enabled: true,
        reason: 'Fixture de pruebas e2e',
        expires_at: null
      }))
    )
    .onConflict((oc) => oc.columns(['tenant_id', 'module']).doUpdateSet({ enabled: true }))
    .execute();
}
