import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { authPlugin } from '../src/shared/plugins/auth.js';
import { errorHandlerPlugin } from '../src/shared/plugins/error-handler.js';
import { adminTenantsRoutes } from '../src/contexts/identity/http/admin-tenants.routes.js';
import type { Database } from '../src/shared/infra/db/schema.js';

type TenantTaxMode = 'IVA' | 'INC_RESTAURANT';
type TableName = 'tenants' | 'audit_logs';

interface FakeDbState {
  tenants: Array<{
    id: string;
    name: string;
    nit: string;
    business_name: string;
    address: string;
    phone: string | null;
    footer_message: string | null;
    tax_mode: TenantTaxMode;
    allow_negative_stock: boolean;
    created_at: Date;
  }>;
  audit_logs: Array<Record<string, unknown>>;
}

interface WhereCondition {
  column: string;
  value: unknown;
}

function lastSegment(column: string): string {
  const parts = column.split('.');
  return parts[parts.length - 1] ?? column;
}

function mapSelectedRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const columnDef of columns) {
    const normalizedDef = columnDef.trim();
    const aliasMatch = normalizedDef.match(/^(.*?)\s+as\s+(.*)$/i);

    if (aliasMatch) {
      mapped[aliasMatch[2]!.trim()] = row[lastSegment(aliasMatch[1]!.trim())];
      continue;
    }

    const sourceColumn = lastSegment(normalizedDef);
    mapped[sourceColumn] = row[sourceColumn];
  }

  return mapped;
}

class FakeSelectBuilder {
  private whereConditions: WhereCondition[] = [];
  private selectedColumns: string[] | null = null;

  constructor(
    private readonly state: FakeDbState,
    private readonly tableName: TableName
  ) {}

  select(columns: string[]): this {
    this.selectedColumns = columns;
    return this;
  }

  where(column: string, op: '=', value: unknown): this {
    if (op !== '=') {
      return this;
    }

    this.whereConditions.push({
      column: lastSegment(column),
      value
    });

    return this;
  }

  forUpdate(): this {
    return this;
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    const rows = this.state[this.tableName] as Record<string, unknown>[];
    const row = rows.find((candidate) =>
      this.whereConditions.every((condition) => candidate[condition.column] === condition.value)
    );

    if (!row) {
      return undefined;
    }

    if (!this.selectedColumns) {
      return row;
    }

    return mapSelectedRow(row, this.selectedColumns);
  }
}

class FakeUpdateBuilder {
  private whereConditions: WhereCondition[] = [];
  private patch: Record<string, unknown> = {};
  private returningColumns: string[] | null = null;

  constructor(
    private readonly state: FakeDbState,
    private readonly tableName: TableName
  ) {}

  set(values: Record<string, unknown>): this {
    this.patch = values;
    return this;
  }

  where(column: string, op: '=', value: unknown): this {
    if (op !== '=') {
      return this;
    }

    this.whereConditions.push({
      column: lastSegment(column),
      value
    });

    return this;
  }

  returning(columns: string[]): this {
    this.returningColumns = columns;
    return this;
  }

  async executeTakeFirstOrThrow(): Promise<Record<string, unknown>> {
    const rows = this.state[this.tableName] as Record<string, unknown>[];
    const target = rows.find((candidate) =>
      this.whereConditions.every((condition) => candidate[condition.column] === condition.value)
    );

    if (!target) {
      throw new Error(`No se encontró fila para actualizar en ${this.tableName}`);
    }

    Object.assign(target, this.patch);

    if (!this.returningColumns) {
      return target;
    }

    return mapSelectedRow(target, this.returningColumns);
  }
}

class FakeInsertBuilder {
  private valuesToInsert: Record<string, unknown>[] = [];

  constructor(
    private readonly state: FakeDbState,
    private readonly tableName: TableName
  ) {}

  values(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.valuesToInsert = Array.isArray(values) ? values : [values];
    return this;
  }

  async execute(): Promise<void> {
    const rows = this.valuesToInsert.map((row) => ({
      ...row,
      created_at: new Date()
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.state[this.tableName] as any[]).push(...rows);
  }
}

class FakeDb {
  constructor(readonly state: FakeDbState) {}

  selectFrom(tableName: TableName): FakeSelectBuilder {
    return new FakeSelectBuilder(this.state, tableName);
  }

  updateTable(tableName: TableName): FakeUpdateBuilder {
    return new FakeUpdateBuilder(this.state, tableName);
  }

  insertInto(tableName: TableName): FakeInsertBuilder {
    return new FakeInsertBuilder(this.state, tableName);
  }

  transaction() {
    return {
      execute: async <T>(callback: (trx: FakeDb) => Promise<T>): Promise<T> => callback(this)
    };
  }

  async destroy(): Promise<void> {}
}

async function buildAdminTenantsApp(state: FakeDbState) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('db', new FakeDb(state) as unknown as Kysely<Database>);

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(adminTenantsRoutes, { prefix: '/api/v1' });
  await app.ready();

  return app;
}

describe('tenant tax mode audit logs', () => {
  let appsToClose: Array<Awaited<ReturnType<typeof buildAdminTenantsApp>>>;

  beforeAll(() => {
    appsToClose = [];
  });

  afterAll(async () => {
    for (const app of appsToClose) {
      await app.close();
    }
  });

  it('writes an audit log when tax_mode is updated', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const state: FakeDbState = {
      tenants: [
        {
          id: tenantId,
          name: 'Tenant Demo',
          nit: '900123123',
          business_name: 'Comercio Demo SAS',
          address: 'Calle 10 # 20-30',
          phone: null,
          footer_message: null,
          tax_mode: 'IVA',
          allow_negative_stock: true,
          created_at: new Date('2026-03-07T00:00:00.000Z')
        }
      ],
      audit_logs: []
    };

    const app = await buildAdminTenantsApp(state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: userId,
      userId,
      tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    , branchIds: ['00000000-0000-0000-0000-000000000000'], permissions: ['sales:create', 'sales:void', 'returns:create', 'inventory:adjust', 'inventory:transfer', 'inventory:receive', 'reports:view', 'cash:reconcile', 'cash:audit', 'settings:manage']});

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tenants/${tenantId}/tax-profile`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        taxMode: 'INC_RESTAURANT'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(state.tenants[0]?.tax_mode).toBe('INC_RESTAURANT');
    expect(state.audit_logs).toHaveLength(1);
    expect(state.audit_logs[0]).toMatchObject({
      tenant_id: tenantId,
      branch_id: null,
      user_id: userId,
      entity_type: 'TENANT',
      entity_id: tenantId,
      action: 'TENANT_TAX_MODE_UPDATED',
      legacy_payload: {
        previous_tax_mode: 'IVA',
        new_tax_mode: 'INC_RESTAURANT'
      }
    });
  });

  it('updates the business profile and writes an audit log', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const state: FakeDbState = {
      tenants: [
        {
          id: tenantId,
          name: 'Tenant Demo',
          nit: '900123123',
          business_name: 'Comercio Demo SAS',
          address: 'Calle 10 # 20-30',
          phone: null,
          footer_message: null,
          tax_mode: 'IVA',
          allow_negative_stock: true,
          created_at: new Date('2026-03-07T00:00:00.000Z')
        }
      ],
      audit_logs: []
    };

    const app = await buildAdminTenantsApp(state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: userId,
      userId,
      tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    , branchIds: ['00000000-0000-0000-0000-000000000000'], permissions: ['sales:create', 'sales:void', 'returns:create', 'inventory:adjust', 'inventory:transfer', 'inventory:receive', 'reports:view', 'cash:reconcile', 'cash:audit', 'settings:manage']});

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/tenants/current',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      payload: {
        businessName: 'Carnes Centro SAS',
        nit: '900123123-7',
        address: 'Cra 7 # 15-20',
        phone: '6011234567',
        footerMessage: 'Gracias por su compra'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: tenantId,
      businessName: 'Carnes Centro SAS',
      nit: '900123123-7',
      address: 'Cra 7 # 15-20',
      phone: '6011234567',
      footerMessage: 'Gracias por su compra',
      taxMode: 'IVA'
    });
    expect(state.tenants[0]).toMatchObject({
      business_name: 'Carnes Centro SAS',
      nit: '900123123-7',
      address: 'Cra 7 # 15-20',
      phone: '6011234567',
      footer_message: 'Gracias por su compra'
    });
    expect(state.audit_logs).toHaveLength(1);
    expect(state.audit_logs[0]).toMatchObject({
      tenant_id: tenantId,
      branch_id: null,
      user_id: userId,
      entity_type: 'TENANT',
      entity_id: tenantId,
      action: 'TENANT_BUSINESS_PROFILE_UPDATED',
      legacy_payload: {
        previous: {
          business_name: 'Comercio Demo SAS',
          address: 'Calle 10 # 20-30',
          phone: null,
          footer_message: null
        },
        current: {
          business_name: 'Carnes Centro SAS',
          address: 'Cra 7 # 15-20',
          phone: '6011234567',
          footer_message: 'Gracias por su compra'
        }
      }
    });
  });
});
