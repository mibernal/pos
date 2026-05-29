import type { Kysely } from 'kysely';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type { Database } from '../../../shared/infra/db/schema.js';

type SaleNumberingDb = Pick<Kysely<Database>, 'selectFrom'>;

interface GetNextSaleNumberInput {
  tenantId: string;
  branchId: string;
}

interface SaleNumberReference {
  tenant_id: string;
  branch_id: string;
  sale_number: number;
}

function parseSaleNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export function getNextSaleNumberFromCollection(
  sales: SaleNumberReference[],
  input: GetNextSaleNumberInput
): number {
  const maxSaleNumber = sales.reduce((maxValue, sale) => {
    if (sale.tenant_id !== input.tenantId || sale.branch_id !== input.branchId) {
      return maxValue;
    }

    return Math.max(maxValue, parseSaleNumber(sale.sale_number));
  }, 0);

  return maxSaleNumber + 1;
}

// Strategy:
// 1. Lock the branch row inside the active transaction.
// 2. Read the max sale_number for that tenant and branch.
// 3. Return max + 1 while the UNIQUE constraint stays as the final safeguard.
//
// This serializes numbering per branch without forcing unrelated branches to wait.
export async function getNextSaleNumberForBranchInTransaction(
  db: SaleNumberingDb,
  input: GetNextSaleNumberInput
): Promise<number> {
  const branch = await db
    .selectFrom('branches')
    .select('id')
    .where('tenant_id', '=', input.tenantId)
    .where('id', '=', input.branchId)
    .forUpdate()
    .executeTakeFirst();

  if (!branch) {
    throw new AppError(400, 'BRANCH_NOT_FOUND', 'La sucursal no existe para este tenant');
  }

  const maxSaleNumberRow = await db
    .selectFrom('sales')
    .select((eb) => eb.fn.max('sale_number').as('max_sale_number'))
    .where('tenant_id', '=', input.tenantId)
    .where('branch_id', '=', input.branchId)
    .executeTakeFirst();

  return parseSaleNumber(maxSaleNumberRow?.max_sale_number) + 1;
}

export function isSaleNumberUniqueConstraintError(error: unknown): boolean {
  const errorLike = error as { code?: string; constraint?: string };

  return (
    errorLike.code === '23505' &&
    errorLike.constraint === 'uq_sales_tenant_branch_sale_number'
  );
}
