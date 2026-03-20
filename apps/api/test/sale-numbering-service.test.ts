import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/infra/db/schema.js';
import {
  getNextSaleNumberForBranchInTransaction,
  getNextSaleNumberFromCollection
} from '../src/domain/sale-numbering-service.js';

type TableName = 'branches' | 'sales';

interface BranchRow {
  id: string;
  tenant_id: string;
}

interface SaleRow {
  tenant_id: string;
  branch_id: string;
  sale_number: number;
}

interface FakeState {
  branches: BranchRow[];
  sales: SaleRow[];
}

interface WhereCondition {
  column: string;
  value: unknown;
}

class FakeSelectBuilder {
  private whereConditions: WhereCondition[] = [];
  private aggregateAlias: string | null = null;
  private aggregateColumn: string | null = null;
  private selectedColumns: string[] = [];

  constructor(
    private readonly state: FakeState,
    private readonly tableName: TableName
  ) {}

  select(selection: unknown): this {
    if (typeof selection === 'string') {
      this.selectedColumns = [selection];
      return this;
    }

    if (typeof selection === 'function') {
      const aggregate = selection({
        fn: {
          max: (column: string) => ({
            as: (alias: string) => ({
              alias,
              column
            })
          })
        }
      } as never) as { alias?: string; column?: string };

      this.aggregateAlias = aggregate.alias ?? null;
      this.aggregateColumn = aggregate.column ?? null;
    }

    return this;
  }

  where(column: string, _op: '=', value: unknown): this {
    this.whereConditions.push({
      column,
      value
    });
    return this;
  }

  forUpdate(): this {
    return this;
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    const rows = this.run();
    return rows[0];
  }

  private run(): Record<string, unknown>[] {
    const rows = this.state[this.tableName] as Record<string, unknown>[];
    const filteredRows = rows.filter((row) =>
      this.whereConditions.every((condition) => row[condition.column] === condition.value)
    );

    if (this.aggregateAlias && this.aggregateColumn) {
      const maxValue = filteredRows.reduce((currentMax, row) => {
        const value = row[this.aggregateColumn!];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          return currentMax;
        }
        return Math.max(currentMax, value);
      }, 0);

      return [
        {
          [this.aggregateAlias]: filteredRows.length > 0 ? maxValue : null
        }
      ];
    }

    if (this.selectedColumns.length === 0) {
      return filteredRows;
    }

    return filteredRows.map((row) =>
      this.selectedColumns.reduce<Record<string, unknown>>((mapped, column) => {
        mapped[column] = row[column];
        return mapped;
      }, {})
    );
  }
}

class FakeDb {
  constructor(private readonly state: FakeState) {}

  selectFrom(tableName: TableName): FakeSelectBuilder {
    return new FakeSelectBuilder(this.state, tableName);
  }
}

describe('sale numbering service', () => {
  it('returns incremental numbering for the same tenant and branch', async () => {
    const nextFromCollection = getNextSaleNumberFromCollection(
      [
        { tenant_id: 'tenant-1', branch_id: 'branch-1', sale_number: 1 },
        { tenant_id: 'tenant-1', branch_id: 'branch-1', sale_number: 2 }
      ],
      {
        tenantId: 'tenant-1',
        branchId: 'branch-1'
      }
    );

    const nextFromTransaction = await getNextSaleNumberForBranchInTransaction(
      new FakeDb({
        branches: [{ id: 'branch-1', tenant_id: 'tenant-1' }],
        sales: [
          { tenant_id: 'tenant-1', branch_id: 'branch-1', sale_number: 1 },
          { tenant_id: 'tenant-1', branch_id: 'branch-1', sale_number: 2 }
        ]
      }) as unknown as Pick<Kysely<Database>, 'selectFrom'>,
      {
        tenantId: 'tenant-1',
        branchId: 'branch-1'
      }
    );

    expect(nextFromCollection).toBe(3);
    expect(nextFromTransaction).toBe(3);
  });

  it('keeps branch numbering independent inside the same tenant', async () => {
    const db = new FakeDb({
      branches: [
        { id: 'branch-a', tenant_id: 'tenant-1' },
        { id: 'branch-b', tenant_id: 'tenant-1' }
      ],
      sales: [
        { tenant_id: 'tenant-1', branch_id: 'branch-a', sale_number: 1 },
        { tenant_id: 'tenant-1', branch_id: 'branch-a', sale_number: 2 },
        { tenant_id: 'tenant-1', branch_id: 'branch-b', sale_number: 1 }
      ]
    }) as unknown as Pick<Kysely<Database>, 'selectFrom'>;

    const nextBranchA = await getNextSaleNumberForBranchInTransaction(db, {
      tenantId: 'tenant-1',
      branchId: 'branch-a'
    });
    const nextBranchB = await getNextSaleNumberForBranchInTransaction(db, {
      tenantId: 'tenant-1',
      branchId: 'branch-b'
    });

    expect(nextBranchA).toBe(3);
    expect(nextBranchB).toBe(2);
  });
});
