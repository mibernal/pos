import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { hashPassword } from '../../src/contexts/identity/auth/password.js';
import { createDb } from '../../src/shared/infra/db/connection.js';
import type { ProductTaxCategory, TenantTaxMode } from '../../src/shared/infra/db/schema.js';

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

export function ensureE2eSchema(): Promise<void> {
  schemaReadyPromise ??= (async () => {
    const db = createDb();
    let schemaLockAcquired = false;

    try {
      await sql`SELECT pg_advisory_lock(hashtext('pos_dian_e2e_schema'))`.execute(db);
      schemaLockAcquired = true;

      await sql`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'IVA'
      `.execute(db);

      await sql`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT 'Dirección no configurada'
      `.execute(db);

      await sql`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS phone TEXT NULL
      `.execute(db);

      await sql`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS footer_message TEXT NULL
      `.execute(db);

      await sql`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS tax_category TEXT NOT NULL DEFAULT 'IVA_19'
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS client_uuid UUID
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS tax_total_cents INTEGER NOT NULL DEFAULT 0
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS tax_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS void_reason TEXT NULL
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS voided_by_user_id UUID NULL
      `.execute(db);

      await sql`
        ALTER TABLE sales
        ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ NULL
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL,
          branch_id UUID NULL,
          user_id UUID NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          action TEXT NOT NULL,
          payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
          CONSTRAINT fk_audit_logs_branch FOREIGN KEY (branch_id) REFERENCES branches (id) ON DELETE SET NULL,
          CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
        )
      `.execute(db);

      await sql`
        ALTER TABLE dian_documents
        ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'INVOICE'
      `.execute(db);

      await sql`
        ALTER TABLE dian_documents
        ADD COLUMN IF NOT EXISTS parent_document_id UUID NULL
      `.execute(db);

      await sql`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'ck_dian_documents_document_type'
              AND conrelid = 'dian_documents'::regclass
          ) THEN
            ALTER TABLE dian_documents
            ADD CONSTRAINT ck_dian_documents_document_type
            CHECK (document_type IN ('INVOICE', 'CREDIT_NOTE'));
          END IF;
        END $$
      `.execute(db);

      await sql`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'fk_dian_documents_parent_document'
              AND conrelid = 'dian_documents'::regclass
          ) THEN
            ALTER TABLE dian_documents
            ADD CONSTRAINT fk_dian_documents_parent_document
            FOREIGN KEY (parent_document_id) REFERENCES dian_documents (id) ON DELETE SET NULL;
          END IF;
        END $$
      `.execute(db);

      await sql`
        ALTER TABLE dian_documents
        DROP CONSTRAINT IF EXISTS uq_dian_documents_tenant_sale
      `.execute(db);

      await sql`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'uq_dian_documents_tenant_sale_type'
              AND conrelid = 'dian_documents'::regclass
          ) THEN
            ALTER TABLE dian_documents
            ADD CONSTRAINT uq_dian_documents_tenant_sale_type
            UNIQUE (tenant_id, sale_id, document_type);
          END IF;
        END $$
      `.execute(db);

      await sql`
        CREATE INDEX IF NOT EXISTS idx_dian_documents_tenant_sale_type
        ON dian_documents (tenant_id, sale_id, document_type)
      `.execute(db);

      await sql`
        ALTER TABLE tenants
        ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT TRUE
      `.execute(db);

      await sql`
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS min_stock_alert_qty INTEGER NULL
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS product_variants (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          name VARCHAR NOT NULL,
          price_cents INTEGER NOT NULL,
          barcode VARCHAR NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        ALTER TABLE sale_items
        ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS promotions (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          type VARCHAR NOT NULL,
          value_cents INTEGER NOT NULL,
          buy_qty INTEGER NULL,
          get_qty INTEGER NULL,
          start_date TIMESTAMP NOT NULL,
          end_date TIMESTAMP NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS sale_returns (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          created_by_user_id UUID NOT NULL REFERENCES users(id),
          total_refund_cents INTEGER NOT NULL CHECK (total_refund_cents >= 0),
          reason TEXT,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `.execute(db);
      await sql`
        CREATE TABLE IF NOT EXISTS return_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          return_id UUID NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id),
          qty NUMERIC(10,3) NOT NULL CHECK (qty > 0),
          refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS cash_movements (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id),
          cash_session_id UUID NOT NULL REFERENCES cash_sessions(id),
          user_id UUID NOT NULL REFERENCES users(id),
          type VARCHAR(10) NOT NULL,
          amount_cents INTEGER NOT NULL,
          reason TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS cash_session_audits (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          cash_session_id UUID NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
          user_id UUID NOT NULL,
          observed_cash_cents INTEGER NOT NULL,
          expected_cash_cents INTEGER NOT NULL,
          diff_cents INTEGER NOT NULL,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS terminals (
          id UUID PRIMARY KEY,
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          name VARCHAR NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS user_branches (
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          PRIMARY KEY (tenant_id, user_id, branch_id)
        )
      `.execute(db);

      await sql`
        CREATE TABLE IF NOT EXISTS inventory_balances (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          variant_id UUID NULL,
          on_hand_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
          reserved_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
          in_transit_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `.execute(db);

      await sql`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE inventory_balances
            ADD COLUMN IF NOT EXISTS on_hand_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(10,3) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS in_transit_qty NUMERIC(10,3) NOT NULL DEFAULT 0;
          EXCEPTION WHEN undefined_table THEN
          END;
        END $$;
      `.execute(db);

      await sql`
        DO $$ BEGIN
          BEGIN
            ALTER TABLE outbox_events
            ADD COLUMN IF NOT EXISTS event_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR NOT NULL DEFAULT 'SALE',
            ADD COLUMN IF NOT EXISTS branch_id UUID NULL,
            ADD COLUMN IF NOT EXISTS metadata_json JSONB NULL;
          EXCEPTION WHEN undefined_table THEN
          END;
        END $$;
      `.execute(db);

    } finally {
      if (schemaLockAcquired) {
        await sql`SELECT pg_advisory_unlock(hashtext('pos_dian_e2e_schema'))`.execute(db);
      }
      await db.destroy();
    }
  })();

  return schemaReadyPromise;
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

  await app.db.transaction().execute(async (trx) => {
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
  await app.db.transaction().execute(async (trx) => {
    await trx.deleteFrom('audit_logs').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('outbox_events').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('dian_documents').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sale_items').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('sales').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('cash_sessions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('inventory_transactions').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('inventory_balances').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('products').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('users').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('terminals').where('tenant_id', '=', fixture.tenantId).execute();
    await trx.deleteFrom('branches').where('tenant_id', '=', fixture.tenantId).execute();
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
