import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  validatorCompiler,
  type ZodTypeProvider
} from 'fastify-type-provider-zod';
import { authPlugin } from '../src/plugins/auth.js';
import { errorHandlerPlugin } from '../src/plugins/error-handler.js';
import { salesRoutes } from '../src/routes/sales.js';
import type { Database } from '../src/infra/db/schema.js';

type TenantTaxMode = 'IVA' | 'INC_RESTAURANT';
type ProductTaxCategory = 'IVA_0' | 'IVA_5' | 'IVA_19' | 'EXEMPT' | 'EXCLUDED' | 'INC_8';

type TableName =
  | 'tenants'
  | 'branches'
  | 'cash_sessions'
  | 'products'
  | 'sales'
  | 'sale_items'
  | 'dian_documents'
  | 'outbox_events'
  | 'audit_logs';

interface FakeDbState {
  tenants: Array<{ id: string; tax_mode: TenantTaxMode }>;
  branches: Array<{ id: string; tenant_id: string }>;
  cash_sessions: Array<{ id: string; tenant_id: string; branch_id: string; closed_at: Date | null }>;
  products: Array<{
    id: string;
    tenant_id: string;
    branch_id: string | null;
    price_cents: number;
    tax_category: ProductTaxCategory;
    active: boolean;
  }>;
  sales: Array<Record<string, unknown>>;
  sale_items: Array<Record<string, unknown>>;
  dian_documents: Array<Record<string, unknown>>;
  outbox_events: Array<Record<string, unknown>>;
  audit_logs: Array<Record<string, unknown>>;
  hooks?: {
    beforeInsert?: (
      tableName: TableName,
      row: Record<string, unknown>,
      state: FakeDbState
    ) => void;
  };
}

interface WhereCondition {
  column: string;
  op: '=' | 'in';
  value: unknown;
}

interface AggregateSelection {
  kind: 'max';
  column: string;
  alias: string;
}

function lastSegment(column: string): string {
  const parts = column.split('.');
  return parts[parts.length - 1] ?? column;
}

function mapSelectedRow(row: Record<string, unknown>, selectedColumns: string[]): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const columnDef of selectedColumns) {
    const normalizedDef = columnDef.trim();
    const aliasMatch = normalizedDef.match(/^(.*?)\s+as\s+(.*)$/i);

    if (aliasMatch) {
      const sourceColumn = lastSegment(aliasMatch[1].trim());
      const alias = aliasMatch[2].trim();
      mapped[alias] = row[sourceColumn];
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
  private aggregateSelection: AggregateSelection | null = null;

  constructor(
    private readonly state: FakeDbState,
    private readonly tableName: TableName
  ) {}

  select(selection: unknown): this {
    if (typeof selection === 'string') {
      this.selectedColumns = [selection];
      return this;
    }

    if (Array.isArray(selection)) {
      this.selectedColumns = selection.filter((item): item is string => typeof item === 'string');
      return this;
    }

    if (typeof selection === 'function') {
      const expressionBuilder = {
        fn: {
          max: (column: string) => ({
            as: (alias: string): AggregateSelection => ({
              kind: 'max',
              column: lastSegment(column),
              alias
            })
          })
        }
      };

      const aggregate = selection(expressionBuilder as never);
      if (aggregate && typeof aggregate === 'object' && 'kind' in aggregate) {
        this.aggregateSelection = aggregate as AggregateSelection;
      }
    }

    return this;
  }

  where(columnOrExpression: unknown, op?: '=' | 'in', value?: unknown): this {
    if (typeof columnOrExpression !== 'string') {
      return this;
    }

    if (op !== '=' && op !== 'in') {
      return this;
    }

    this.whereConditions.push({
      column: lastSegment(columnOrExpression),
      op,
      value
    });

    return this;
  }

  forUpdate(): this {
    return this;
  }

  orderBy(): this {
    return this;
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    const rows = await this.execute();
    return rows[0];
  }

  async execute(): Promise<Record<string, unknown>[]> {
    const baseRows = [...this.state[this.tableName]] as Record<string, unknown>[];

    const filteredRows = baseRows.filter((row) =>
      this.whereConditions.every((condition) => {
        const currentValue = row[condition.column];

        if (condition.op === '=') {
          return currentValue === condition.value;
        }

        if (!Array.isArray(condition.value)) {
          return false;
        }

        return condition.value.includes(currentValue);
      })
    );

    if (this.aggregateSelection?.kind === 'max') {
      const numericValues = filteredRows
        .map((row) => row[this.aggregateSelection!.column])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      const maxValue = numericValues.length > 0 ? Math.max(...numericValues) : null;

      return [{
        [this.aggregateSelection.alias]: maxValue
      }];
    }

    if (!this.selectedColumns || this.selectedColumns.length === 0) {
      return filteredRows;
    }

    return filteredRows.map((row) => mapSelectedRow(row, this.selectedColumns!));
  }
}

class FakeInsertBuilder {
  private rowsToInsert: Record<string, unknown>[] = [];
  private returningColumns: string[] | null = null;

  constructor(
    private readonly state: FakeDbState,
    private readonly tableName: TableName
  ) {}

  values(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.rowsToInsert = Array.isArray(values) ? values : [values];
    return this;
  }

  returning(columns: string[]): this {
    this.returningColumns = columns;
    return this;
  }

  async executeTakeFirstOrThrow(): Promise<Record<string, unknown>> {
    const insertedRows = this.persist();
    const firstInserted = insertedRows[0];
    if (!firstInserted) {
      throw new Error('No se insertaron filas');
    }

    if (!this.returningColumns || this.returningColumns.length === 0) {
      return firstInserted;
    }

    return mapSelectedRow(firstInserted, this.returningColumns);
  }

  async execute(): Promise<void> {
    this.persist();
  }

  private persist(): Record<string, unknown>[] {
    const now = new Date();
    const insertedRows = this.rowsToInsert.map((row) => {
      const normalizedJsonRow = Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          if (!key.endsWith('_json') || typeof value !== 'string') {
            return [key, value];
          }

          try {
            return [key, JSON.parse(value)];
          } catch {
            return [key, value];
          }
        })
      );
      const withDates = { ...normalizedJsonRow };

      if (this.tableName === 'sales') {
        withDates.created_at = now;
      }

      if (this.tableName === 'dian_documents' || this.tableName === 'outbox_events') {
        withDates.created_at = now;
        withDates.updated_at = now;
      }

      if (this.tableName === 'audit_logs') {
        withDates.created_at = now;
      }

      return withDates;
    });

    for (const row of insertedRows) {
      this.state.hooks?.beforeInsert?.(this.tableName, row, this.state);
    }

    this.state[this.tableName].push(...insertedRows);
    return insertedRows;
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

  where(columnOrExpression: unknown, op?: '=' | 'in', value?: unknown): this {
    if (typeof columnOrExpression !== 'string') {
      return this;
    }

    if (op !== '=' && op !== 'in') {
      return this;
    }

    this.whereConditions.push({
      column: lastSegment(columnOrExpression),
      op,
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
    const targetRow = rows.find((row) =>
      this.whereConditions.every((condition) => {
        const currentValue = row[condition.column];

        if (condition.op === '=') {
          return currentValue === condition.value;
        }

        if (!Array.isArray(condition.value)) {
          return false;
        }

        return condition.value.includes(currentValue);
      })
    );

    if (!targetRow) {
      throw new Error(`No se encontró fila para actualizar en ${this.tableName}`);
    }

    Object.assign(targetRow, this.patch);

    if (!this.returningColumns || this.returningColumns.length === 0) {
      return targetRow;
    }

    return mapSelectedRow(targetRow, this.returningColumns);
  }
}

class FakeDb {
  constructor(readonly state: FakeDbState) {}

  selectFrom(tableName: TableName): FakeSelectBuilder {
    return new FakeSelectBuilder(this.state, tableName);
  }

  insertInto(tableName: TableName): FakeInsertBuilder {
    return new FakeInsertBuilder(this.state, tableName);
  }

  updateTable(tableName: TableName): FakeUpdateBuilder {
    return new FakeUpdateBuilder(this.state, tableName);
  }

  transaction() {
    return {
      execute: async <T>(callback: (trx: FakeDb) => Promise<T>): Promise<T> => callback(this)
    };
  }

  async destroy(): Promise<void> {}
}

function createFixture(
  taxMode: TenantTaxMode,
  productTaxCategory: ProductTaxCategory,
  linePriceCents: number
): {
  state: FakeDbState;
  tenantId: string;
  branchId: string;
  cashSessionId: string;
  userId: string;
  productId: string;
  linePriceCents: number;
} {
  const tenantId = randomUUID();
  const branchId = randomUUID();
  const cashSessionId = randomUUID();
  const userId = randomUUID();
  const productId = randomUUID();

  const state: FakeDbState = {
    tenants: [{ id: tenantId, tax_mode: taxMode }],
    branches: [{ id: branchId, tenant_id: tenantId }],
    cash_sessions: [
      {
        id: cashSessionId,
        tenant_id: tenantId,
        branch_id: branchId,
        closed_at: null
      }
    ],
    products: [
      {
        id: productId,
        tenant_id: tenantId,
        branch_id: branchId,
        price_cents: linePriceCents,
        tax_category: productTaxCategory,
        active: true
      }
    ],
    sales: [],
    sale_items: [],
    dian_documents: [],
    outbox_events: [],
    audit_logs: []
  };

  return {
    state,
    tenantId,
    branchId,
    cashSessionId,
    userId,
    productId,
    linePriceCents
  };
}

async function buildSalesApp(state: FakeDbState) {
  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);

  app.decorate('db', new FakeDb(state) as unknown as Kysely<Database>);
  app.decorate('dianQueue', {
    add: async () => ({ id: 'fake-job' }),
    close: async () => undefined
  });

  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);
  await app.register(salesRoutes, { prefix: '/api/v1' });
  await app.ready();

  return app;
}

describe('POST /sales fiscal persistence', () => {
  let appsToClose: Array<Awaited<ReturnType<typeof buildSalesApp>>>;

  beforeAll(() => {
    appsToClose = [];
  });

  afterAll(async () => {
    for (const app of appsToClose) {
      await app.close();
    }
  });

  it('persists IVA_19 tax lines and tax_total_cents in DB and response', async () => {
    const fixture = createFixture('IVA', 'IVA_19', 11900);
    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: fixture.cashSessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
      }
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: {
        subtotal_cents: number;
        discount_cents: number;
        total_cents: number;
        tax_total_cents: number;
        tax_lines_json: Array<{
          category: string;
          base_cents: number;
          tax_cents: number;
          rate: number;
        }>;
      };
    };

    expect(body.sale.total_cents).toBe(body.sale.subtotal_cents - body.sale.discount_cents);
    expect(body.sale.tax_total_cents).toBe(1900);
    expect(body.sale.tax_lines_json).toEqual([
      {
        line_index: 0,
        category: 'IVA_19',
        base_cents: 10000,
        tax_cents: 1900,
        rate: 0.19
      }
    ]);

    const persistedSale = fixture.state.sales[0] as {
      tax_total_cents: number;
      tax_lines_json: Array<Record<string, unknown>>;
      total_cents: number;
      subtotal_cents: number;
      discount_cents: number;
    };

    expect(persistedSale.tax_total_cents).toBe(1900);
    expect(persistedSale.tax_lines_json).toEqual(body.sale.tax_lines_json);
    expect(persistedSale.total_cents).toBe(persistedSale.subtotal_cents - persistedSale.discount_cents);
    expect(fixture.state.audit_logs).toHaveLength(1);
    expect(fixture.state.audit_logs[0]).toMatchObject({
      tenant_id: fixture.tenantId,
      branch_id: fixture.branchId,
      user_id: fixture.userId,
      entity_type: 'SALE',
      entity_id: persistedSale.id,
      action: 'SALE_CREATED',
      payload_json: expect.objectContaining({
        sale_number: 1,
        total_cents: body.sale.total_cents,
        tax_total_cents: 1900
      })
    });
  });

  it('persists INC_RESTAURANT tax lines and keeps total formula unchanged', async () => {
    const fixture = createFixture('INC_RESTAURANT', 'INC_8', 10800);
    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: fixture.cashSessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
      }
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: {
        subtotal_cents: number;
        discount_cents: number;
        total_cents: number;
        tax_total_cents: number;
        tax_lines_json: Array<{
          category: string;
          base_cents: number;
          tax_cents: number;
          rate: number;
        }>;
      };
    };

    expect(body.sale.total_cents).toBe(body.sale.subtotal_cents - body.sale.discount_cents);
    expect(body.sale.tax_total_cents).toBe(800);
    expect(body.sale.tax_lines_json).toEqual([
      {
        line_index: 0,
        category: 'INC',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08
      }
    ]);

    const persistedSale = fixture.state.sales[0] as {
      tax_total_cents: number;
      tax_lines_json: Array<Record<string, unknown>>;
      total_cents: number;
      subtotal_cents: number;
      discount_cents: number;
    };

    expect(persistedSale.tax_total_cents).toBe(800);
    expect(persistedSale.tax_lines_json).toEqual(body.sale.tax_lines_json);
    expect(persistedSale.total_cents).toBe(persistedSale.subtotal_cents - persistedSale.discount_cents);
  });

  it('ignores tax_category overrides sent by the client and uses DB product tax_category', async () => {
    const fixture = createFixture('IVA', 'IVA_19', 11900);
    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: fixture.cashSessionId,
        items: [
          {
            product_id: fixture.productId,
            qty: 1,
            tax_category: 'EXEMPT'
          }
        ],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      sale: {
        tax_total_cents: 1900,
        tax_lines_json: [
          {
            category: 'IVA_19',
            base_cents: 10000,
            tax_cents: 1900,
            rate: 0.19
          }
        ]
      }
    });
  });

  it('retries safely when sale_number collides during concurrent creation', async () => {
    const fixture = createFixture('IVA', 'IVA_19', 11900);
    let collisionInjected = false;

    fixture.state.hooks = {
      beforeInsert: (tableName, row, state) => {
        if (
          tableName === 'sales' &&
          row.tenant_id === fixture.tenantId &&
          row.branch_id === fixture.branchId &&
          row.sale_number === 1 &&
          !collisionInjected
        ) {
          collisionInjected = true;
          state.sales.push({
            id: randomUUID(),
            tenant_id: fixture.tenantId,
            client_uuid: randomUUID(),
            branch_id: fixture.branchId,
            cash_session_id: fixture.cashSessionId,
            sale_number: 1,
            status: 'COMPLETED',
            subtotal_cents: fixture.linePriceCents,
            discount_cents: 0,
            total_cents: fixture.linePriceCents,
            tax_total_cents: 1900,
            tax_lines_json: [],
            payment_json: {
              mode: 'CASH',
              total_cents: fixture.linePriceCents,
              payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }],
              amounts: {
                cash_cents: fixture.linePriceCents,
                card_cents: 0,
                transfer_cents: 0
              }
            },
            created_by_user_id: randomUUID(),
            void_reason: null,
            voided_by_user_id: null,
            voided_at: null,
            created_at: new Date()
          });

          throw Object.assign(new Error('duplicate sale_number'), {
            code: '23505',
            constraint: 'uq_sales_tenant_branch_sale_number'
          });
        }
      }
    };

    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: fixture.cashSessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
      }
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as {
      sale: {
        sale_number: number;
      };
    };

    expect(body.sale.sale_number).toBe(2);
    expect(
      fixture.state.sales
        .map((sale) => sale.sale_number)
        .filter((value): value is number => typeof value === 'number')
        .sort((left, right) => left - right)
    ).toEqual([1, 2]);
    expect(fixture.state.audit_logs[0]).toMatchObject({
      payload_json: expect.objectContaining({
        sale_number: 2
      })
    });
  });

  it('returns the existing sale for the same client_uuid without duplicating records', async () => {
    const fixture = createFixture('IVA', 'IVA_19', 11900);
    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });
    const clientUuid = randomUUID();
    const payload = {
      client_uuid: clientUuid,
      branch_id: fixture.branchId,
      cash_session_id: fixture.cashSessionId,
      items: [{ product_id: fixture.productId, qty: 1 }],
      discount_cents: 0,
      payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
    };

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload
    });

    expect(firstResponse.statusCode).toBe(201);

    const firstBody = firstResponse.json() as {
      sale: {
        id: string;
        sale_number: number;
      };
      items: Array<{
        product_id: string;
        qty: number;
      }>;
    };

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload
    });

    expect(secondResponse.statusCode).toBe(200);

    const secondBody = secondResponse.json() as {
      sale: {
        id: string;
        sale_number: number;
      };
      items: Array<{
        product_id: string;
        qty: number;
      }>;
    };

    expect(secondBody).toEqual(firstBody);
    expect(fixture.state.sales).toHaveLength(1);
    expect(fixture.state.sale_items).toHaveLength(1);
    expect(fixture.state.audit_logs).toHaveLength(1);
    expect(fixture.state.audit_logs[0]).toMatchObject({
      action: 'SALE_CREATED',
      entity_id: firstBody.sale.id
    });
  });

  it('persists void metadata, writes audit log and rejects a second void attempt', async () => {
    const fixture = createFixture('IVA', 'IVA_19', 11900);
    const app = await buildSalesApp(fixture.state);
    appsToClose.push(app);

    const token = app.jwt.sign({
      sub: fixture.userId,
      userId: fixture.userId,
      tenantId: fixture.tenantId,
      role: 'ADMIN',
      email: 'admin@test.local',
      name: 'Admin Test'
    });

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: fixture.cashSessionId,
        items: [{ product_id: fixture.productId, qty: 1 }],
        discount_cents: 0,
        payments: [{ method: 'CASH', amount_cents: fixture.linePriceCents }]
      }
    });

    expect(createResponse.statusCode).toBe(201);

    const createdSale = createResponse.json() as {
      sale: {
        id: string;
        sale_number: number;
        total_cents: number;
        void_reason: string | null;
        voided_by_user_id: string | null;
        voided_at: string | null;
      };
    };

    expect(createdSale.sale.void_reason).toBeNull();
    expect(createdSale.sale.voided_by_user_id).toBeNull();
    expect(createdSale.sale.voided_at).toBeNull();

    const voidResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${createdSale.sale.id}/void`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        void_reason: 'Cliente canceló el pedido'
      }
    });

    expect(voidResponse.statusCode).toBe(200);

    const voidedSale = voidResponse.json() as {
      sale: {
        id: string;
        status: 'VOID';
        void_reason: string;
        voided_by_user_id: string;
        voided_at: string;
      };
    };

    expect(voidedSale.sale.status).toBe('VOID');
    expect(voidedSale.sale.void_reason).toBe('Cliente canceló el pedido');
    expect(voidedSale.sale.voided_by_user_id).toBe(fixture.userId);
    expect(voidedSale.sale.voided_at).toBeTruthy();

    const persistedVoidedSale = fixture.state.sales[0] as {
      status: string;
      void_reason: string | null;
      voided_by_user_id: string | null;
      voided_at: Date | null;
    };

    expect(persistedVoidedSale.status).toBe('VOID');
    expect(persistedVoidedSale.void_reason).toBe('Cliente canceló el pedido');
    expect(persistedVoidedSale.voided_by_user_id).toBe(fixture.userId);
    expect(persistedVoidedSale.voided_at).toBeInstanceOf(Date);

    expect(fixture.state.audit_logs).toHaveLength(2);
    expect(fixture.state.audit_logs[1]).toMatchObject({
      tenant_id: fixture.tenantId,
      branch_id: fixture.branchId,
      user_id: fixture.userId,
      entity_type: 'SALE',
      entity_id: createdSale.sale.id,
      action: 'SALE_VOIDED',
      payload_json: {
        sale_number: createdSale.sale.sale_number,
        previous_status: 'COMPLETED',
        new_status: 'VOID',
        total_cents: createdSale.sale.total_cents,
        void_reason: 'Cliente canceló el pedido',
        dian_adjustment_pending: true
      }
    });

    const secondVoidResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/sales/${createdSale.sale.id}/void`,
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {
        void_reason: 'Intento duplicado'
      }
    });

    expect(secondVoidResponse.statusCode).toBe(409);
    expect(fixture.state.audit_logs).toHaveLength(2);
  });
});
