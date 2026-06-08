import { LedgerCrypto } from './ledger-utils.js';
import { sql } from 'kysely'; // eslint-disable-line @typescript-eslint/no-unused-vars
import type { Database } from './schema.js';
import type { Kysely } from 'kysely';

export async function runLedgerBackfill(db: Kysely<Database>) {
  console.log('Iniciando sincronización histórica de Ledgers...');
  
  await db.transaction().execute(async (trx) => {
    // Para simplificar, migraremos sólo las ventas que no están en el ledger
    const existingSales = await trx
      .selectFrom('sales')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();

    let sequence = 1n;
    let previousHash = LedgerCrypto.GENESIS_HASH;
    let processed = 0;

    for (const sale of existingSales) {
      const isVoid = sale.status === 'VOID';
      
      const payload = {
        tenantId: sale.tenant_id,
        saleId: sale.id,
        type: isVoid ? 'SALE_VOID' : 'SALE_CREATION',
        amountCents: isVoid ? -Number(sale.total_cents) : Number(sale.total_cents),
        taxAmountCents: isVoid ? -Number(sale.tax_total_cents) : Number(sale.tax_total_cents),
        sequenceNumber: sequence,
        previousHash
      };

      const hash = LedgerCrypto.calculateHash(payload);

      await trx
        .insertInto('sales_ledger')
        .values({
          tenant_id: sale.tenant_id,
          sale_id: sale.id,
          type: isVoid ? 'SALE_VOID' : 'SALE_CREATION',
          amount_cents: String(payload.amountCents),
          tax_amount_cents: String(payload.taxAmountCents),
          sequence_number: String(sequence),
          previous_hash: previousHash,
          hash,
          created_by_user_id: sale.created_by_user_id,
          created_at: sale.created_at
        })
        .onConflict((oc) => oc.column('hash').doNothing()) // Evitar colisiones si ya se migró
        .execute();

      previousHash = hash;
      sequence += 1n;
      processed++;
    }

    console.log(`✅ Backfill de Sales Ledger completado. Procesadas: ${processed}`);
  });
}
