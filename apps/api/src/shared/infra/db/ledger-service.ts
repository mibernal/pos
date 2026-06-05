import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database, SalesLedgerOperation, InventoryLedgerOperation, CashLedgerOperation } from './schema.js';
import { LedgerCrypto } from './ledger-utils.js';

export class LedgerService {
  /**
   * Agrega un registro inmutable al Sales Ledger.
   */
  static async appendSalesLedger(
    trx: Transaction<Database>,
    params: {
      tenantId: string;
      saleId: string;
      type: SalesLedgerOperation;
      amountCents: number;
      taxAmountCents: number;
      userId: string;
    }
  ): Promise<void> {
    // 1. Obtener la secuencia anterior para este tenant (bloqueando concurrentes)
    // Para no bloquear todas las ventas del tenant globalmente, podemos agrupar la secuencia 
    // a nivel global usando una pseudo-tabla o simplemente confiando en insert-select con max(seq).
    // Usaremos un advisory lock o un simple FOR UPDATE sobre el tenant para garantizar serialidad.
    // (En alto tráfico, el ledger sequence per tenant puede ser un cuello de botella. 
    // Lo ideal es tener secuencias per branch o per cash_session). 
    // Para esta prueba, usaremos MAX() y un RETRY nativo del Unique Constraint, 
    // o bloquearemos el registro del tenant temporalmente.
    
    await sql`SELECT 1 FROM tenants WHERE id = ${params.tenantId} FOR UPDATE`.execute(trx);

    const lastEntry = await trx
      .selectFrom('sales_ledger')
      .select(['sequence_number', 'hash'])
      .where('tenant_id', '=', params.tenantId)
      .orderBy('sequence_number', 'desc')
      .limit(1)
      .executeTakeFirst();

    const sequenceNumber = lastEntry ? BigInt(lastEntry.sequence_number) + 1n : 1n;
    const previousHash = lastEntry ? lastEntry.hash : LedgerCrypto.GENESIS_HASH;

    const hashPayload = {
      tenantId: params.tenantId,
      saleId: params.saleId,
      type: params.type,
      amountCents: params.amountCents,
      taxAmountCents: params.taxAmountCents,
      sequenceNumber,
      previousHash
    };

    const hash = LedgerCrypto.calculateHash(hashPayload);

    await trx
      .insertInto('sales_ledger')
      .values({
        tenant_id: params.tenantId,
        sale_id: params.saleId,
        type: params.type,
        amount_cents: String(params.amountCents),
        tax_amount_cents: String(params.taxAmountCents),
        sequence_number: String(sequenceNumber),
        previous_hash: previousHash,
        hash,
        created_by_user_id: params.userId
      })
      .execute();
  }

  /**
   * Agrega un registro inmutable al Inventory Ledger.
   */
  static async appendInventoryLedger(
    trx: Transaction<Database>,
    params: {
      tenantId: string;
      branchId: string;
      productId: string;
      variantId: string | null;
      operation: InventoryLedgerOperation;
      qtyChange: number;
      balanceAfter: number;
      referenceId: string;
    }
  ): Promise<void> {
    // Bloquear el producto/variante para secuencia
    await trx
      .selectFrom('inventory_balances')
      .select('id')
      .where('tenant_id', '=', params.tenantId)
      .where('branch_id', '=', params.branchId)
      .where('product_id', '=', params.productId)
      .where((eb) => params.variantId === null ? eb('variant_id', 'is', null) : eb('variant_id', '=', params.variantId))
      .forUpdate()
      .executeTakeFirst();

    const lastEntry = await trx
      .selectFrom('inventory_ledger')
      .select(['sequence_number', 'hash'])
      .where('tenant_id', '=', params.tenantId)
      .where('branch_id', '=', params.branchId)
      .where('product_id', '=', params.productId)
      .where((eb) => params.variantId === null ? eb('variant_id', 'is', null) : eb('variant_id', '=', params.variantId))
      .orderBy('sequence_number', 'desc')
      .limit(1)
      .executeTakeFirst();

    const sequenceNumber = lastEntry ? BigInt(lastEntry.sequence_number) + 1n : 1n;
    const previousHash = lastEntry ? lastEntry.hash : LedgerCrypto.GENESIS_HASH;

    const hashPayload = {
      tenantId: params.tenantId,
      branchId: params.branchId,
      productId: params.productId,
      variantId: params.variantId,
      operation: params.operation,
      qtyChange: params.qtyChange,
      balanceAfter: params.balanceAfter,
      referenceId: params.referenceId,
      sequenceNumber,
      previousHash
    };

    const hash = LedgerCrypto.calculateHash(hashPayload);

    await trx
      .insertInto('inventory_ledger')
      .values({
        tenant_id: params.tenantId,
        branch_id: params.branchId,
        product_id: params.productId,
        variant_id: params.variantId,
        operation_type: params.operation,
        qty_change: String(params.qtyChange),
        balance_after: String(params.balanceAfter),
        reference_id: params.referenceId,
        sequence_number: String(sequenceNumber),
        previous_hash: previousHash,
        hash
      })
      .execute();
  }

  /**
   * Agrega un registro inmutable al Cash Ledger.
   */
  static async appendCashLedger(
    trx: Transaction<Database>,
    params: {
      tenantId: string;
      cashSessionId: string;
      terminalId: string;
      type: CashLedgerOperation;
      amountCents: number;
      balanceAfterCents: number;
    }
  ): Promise<void> {
    await trx
      .selectFrom('cash_sessions')
      .select('id')
      .where('id', '=', params.cashSessionId)
      .forUpdate()
      .executeTakeFirst();

    const lastEntry = await trx
      .selectFrom('cash_ledger')
      .select(['sequence_number', 'hash'])
      .where('cash_session_id', '=', params.cashSessionId)
      .orderBy('sequence_number', 'desc')
      .limit(1)
      .executeTakeFirst();

    const sequenceNumber = lastEntry ? BigInt(lastEntry.sequence_number) + 1n : 1n;
    const previousHash = lastEntry ? lastEntry.hash : LedgerCrypto.GENESIS_HASH;

    const hashPayload = {
      tenantId: params.tenantId,
      cashSessionId: params.cashSessionId,
      terminalId: params.terminalId,
      type: params.type,
      amountCents: params.amountCents,
      balanceAfterCents: params.balanceAfterCents,
      sequenceNumber,
      previousHash
    };

    const hash = LedgerCrypto.calculateHash(hashPayload);

    await trx
      .insertInto('cash_ledger')
      .values({
        tenant_id: params.tenantId,
        cash_session_id: params.cashSessionId,
        terminal_id: params.terminalId,
        type: params.type,
        amount_cents: String(params.amountCents),
        balance_after_cents: String(params.balanceAfterCents),
        sequence_number: String(sequenceNumber),
        previous_hash: previousHash,
        hash
      })
      .execute();
  }
}
