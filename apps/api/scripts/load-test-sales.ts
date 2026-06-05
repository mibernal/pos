import { randomUUID } from 'crypto';
import { createDb } from '../src/shared/infra/db/connection.js';
import { createSaleService } from '../src/contexts/sales/services/create-sale.service.js';

import { executeAsTenant } from '../src/shared/infra/db/rls.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';
const cashierUserId = '44444444-4444-4444-8444-444444444444';

const db = createDb();

// Fake logger
const logger: any = {
  info: () => { },
  warn: () => { },
  error: () => { },
  debug: () => { }
};

async function runLoadTest(concurrentSales: number) {
  console.log(`\n==========================================`);
  console.log(`Iniciando prueba de carga con ${concurrentSales} ventas simultáneas...`);

  // Crear una sesión de caja para la prueba
  let cashSessionId: string = randomUUID();
  let prod1: any;
  let prod2: any;

  await executeAsTenant(db, tenantId, async (trx) => {
    // Elegir terminal y sesion de caja
    const terminal = await trx.selectFrom('terminals').selectAll().where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst();
    if (!terminal) throw new Error('No terminal found for tenant/branch');

    const existingSession = await trx.selectFrom('cash_sessions').selectAll()
      .where('tenant_id', '=', tenantId)
      .where('terminal_id', '=', terminal.id)
      .where('status', '=', 'OPEN')
      .executeTakeFirst();

    if (existingSession) {
      cashSessionId = existingSession.id;
    } else {
      await trx.insertInto('cash_sessions').values({
        id: cashSessionId,
        tenant_id: tenantId,
        branch_id: branchId,
        terminal_id: terminal.id,
        opened_by_user_id: cashierUserId,
        opening_amount_cents: 0,
        status: 'OPEN'
      }).execute();
    }

    // Elegir productos
    const products = await trx.selectFrom('products').selectAll().where('tenant_id', '=', tenantId).execute();
    prod1 = products[0];
    prod2 = products[1];
  });

  if (!prod1 || !prod2) {
    throw new Error('Not enough products found for load testing');
  }

  let successCount = 0;
  let errorCount = 0;
  let deadlockCount = 0;

  const start = Date.now();

  const promises = [];
  for (let i = 0; i < concurrentSales; i++) {
    // Alternar el orden en que se agregan los productos para forzar deadlocks si no se ordena internamente
    const items = i % 2 === 0
      ? [
        { product_id: prod1.id, qty: 1, price_cents: prod1.price_cents },
        { product_id: prod2.id, qty: 1, price_cents: prod2.price_cents }
      ]
      : [
        { product_id: prod2.id, qty: 1, price_cents: prod2.price_cents },
        { product_id: prod1.id, qty: 1, price_cents: prod1.price_cents }
      ];

    const subtotal = prod1.price_cents + prod2.price_cents;

    promises.push(
      createSaleService({
        db,
        logger,
        tenantId,
        userId: cashierUserId,
        userRole: 'CASHIER',
        payload: {
          client_uuid: randomUUID(),
          branch_id: branchId,
          cash_session_id: cashSessionId,
          items,
          discount_cents: 0,
          payments: [
            {
              method: 'CASH',
              amount_cents: subtotal
            }
          ]
        },
        requestLogContext: {}
      })
        .then(() => { successCount++; })
        .catch((err: any) => {
          errorCount++;
          if (err.message && err.message.toLowerCase().includes('deadlock')) {
            deadlockCount++;
          } else {
            // console.error(err);
          }
        })
    );
  }

  await Promise.all(promises);

  const end = Date.now();
  console.log(`\nResultados para ${concurrentSales} ventas:`);
  console.log(`Tiempo: ${end - start}ms`);
  console.log(`Éxitos: ${successCount}`);
  console.log(`Errores: ${errorCount} (Deadlocks: ${deadlockCount})`);
}

async function main() {
  try {
    await runLoadTest(100);
    await runLoadTest(500);
    await runLoadTest(1000);
    await runLoadTest(5000);
  } finally {
    await db.destroy();
  }
}

main().catch(console.error);
