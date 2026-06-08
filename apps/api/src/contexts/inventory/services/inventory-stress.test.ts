import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../../shared/infra/db/connection.js';
import { recordInventoryTransaction } from '../http/inventory.routes.js';
import { sql } from 'kysely'; // eslint-disable-line @typescript-eslint/no-unused-vars

const db = createDb();

describe('Inventory Concurrency Stress Test', () => {
  const tenantId = randomUUID();
  const branchId = randomUUID();
  const productId = randomUUID();
  const userId = randomUUID();

  beforeAll(async () => {
    // Setup test data
    await db.insertInto('tenants').values({
      id: tenantId,
      name: 'Stress Test Tenant',
      business_name: 'Stress Test',
      nit: '000000',
      address: 'Test',
      allow_negative_stock: false
    }).execute();

    await db.insertInto('branches').values({
      id: branchId,
      tenant_id: tenantId!,
      name: 'Main Branch',
      address: 'Test'
    }).execute();

    await db.insertInto('users').values({
      id: userId,
      tenant_id: tenantId!,
      email: `stress.${randomUUID()}@test.com`,
      password_hash: '123',
      name: 'Stress',
      role: 'ADMIN'
    }).execute();

    await db.insertInto('products').values({
      id: productId,
      tenant_id: tenantId!,
      branch_id: branchId!,
      name: 'Stress Test Product',
      category: 'TEST',
      price_cents: 1000,
      cost_cents: 500,
      active: true
    }).execute();

    // Initial stock: 50
    await db.insertInto('inventory_balances').values({
      tenant_id: tenantId!,
      branch_id: branchId!,
      product_id: productId,
      on_hand_qty: '50',
      in_transit_qty: '0',
      reserved_qty: '0',
      version: 1
    }).execute();
  });

  afterAll(async () => {
    // Cleanup
    await db.deleteFrom('inventory_transactions').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('inventory_balances').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('products').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('users').where('id', '=', userId).execute();
    await db.deleteFrom('branches').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('should handle 100 concurrent sales attempts without dropping below 0', async () => {
    const promises = Array.from({ length: 100 }).map(() => {
      return db.transaction().execute(async (trx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        await recordInventoryTransaction(trx, {
          tenantId,
          branchId,
          productId,
          variantId: null,
          operation: 'SALE',
          referenceId: randomUUID(),
          qtyChange: -1,
          notes: 'Stress test sale',
          userId
        });
      }).catch((err: any) => err); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    const results = await Promise.all(promises);
    const successes = results.filter((r: any) => !(r instanceof Error)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const failures = results.filter((r: any) => r instanceof Error); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Initial stock is 50, each sale is -1. So exactly 50 should succeed.
    expect(successes.length).toBe(50);
    // The other 50 should fail due to INSUFFICIENT_STOCK
    expect(failures.length).toBe(50);

    const balance = await db.selectFrom('inventory_balances')
      .select('on_hand_qty')
      .where('product_id', '=', productId)
      .executeTakeFirst();

    // Balance should be exactly 0
    expect(Number(balance?.on_hand_qty)).toBe(0);
  });

  it('should fail concurrent updates on same version for adjustments', async () => {
    const balance = await db.selectFrom('inventory_balances')
      .select('version')
      .where('product_id', '=', productId)
      .executeTakeFirstOrThrow();

    const expectedVersion = Number(balance.version);

    // Try two concurrent adjustments expecting the same version
    const promise1 = db.transaction().execute(async (trx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await recordInventoryTransaction(trx, {
        tenantId,
        branchId,
        productId,
        variantId: null,
        operation: 'ADJUSTMENT_IN',
        referenceId: randomUUID(),
        qtyChange: +10,
        notes: 'Adjustment 1',
        expectedVersion, // Both expect current version
        userId
      });
    });

    // Pequeño delay para forzar el race (Promise 1 bloquea la tabla, Promise 2 intenta leer la versión, pero espera. Cuando la lee, la versión ya avanzó).
    // Espera, recordInventoryTransaction usa select ... forUpdate(), así que P2 se quedará esperando el lock de P1. 
    // Al liberarse, P2 reevaluará y el "balance.version" en mem ya será expectedVersion+1, y lanzará OPTIMISTIC_LOCK_FAILED.

    const promise2 = db.transaction().execute(async (trx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      await recordInventoryTransaction(trx, {
        tenantId,
        branchId,
        productId,
        variantId: null,
        operation: 'ADJUSTMENT_IN',
        referenceId: randomUUID(),
        qtyChange: +20,
        notes: 'Adjustment 2',
        expectedVersion,
        userId
      });
    });

    const results = await Promise.allSettled([promise1, promise2]);

    // Exactly one should succeed, one should fail with OPTIMISTIC_LOCK_FAILED
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);

    if (failed[0] && 'reason' in failed[0]) {
      expect((failed[0] as any).reason.message).toContain('El inventario ha sido modificado por otro usuario'); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
  });
});
