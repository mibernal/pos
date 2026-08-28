import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { createDb } from '../../../../shared/infra/db/connection.js';
import { SubscriptionService } from '../subscription.service.js';

describe('SubscriptionService (Integration)', () => {
  const db = createDb();
  let testTenantId: string;

  beforeEach(async () => {
    testTenantId = randomUUID();
    
    // Insert base tenant first
    await db.insertInto('tenants').values({
      id: testTenantId,
      name: 'Integration Test Tenant',
      business_name: 'Integration Test S.A.S.',
      nit: `999-${Math.floor(Math.random() * 1000000)}`,
      address: 'Test Addr',
      status: 'TRIAL'
    }).execute();
  });

  afterEach(async () => {
    // Delete test tenant explicitly or via cascade
    await db.deleteFrom('tenants').where('id', '=', testTenantId).execute();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('debería crear una suscripción TRIAL', async () => {
    const subId = await SubscriptionService.createSubscription(db, testTenantId, 'STARTER', 'TRIAL', 14);

    expect(subId).toBeDefined();

    const sub = await db.selectFrom('tenant_subscriptions')
      .where('id', '=', subId)
      .selectAll()
      .executeTakeFirst();

    expect(sub).toBeDefined();
    expect(sub?.status).toBe('TRIAL');
    expect(sub?.plan_id).toBe('STARTER');
  });

  it('debería activar una suscripción', async () => {
    const subId = await SubscriptionService.createSubscription(db, testTenantId, 'PRO', 'TRIAL', 14);

    await SubscriptionService.activateSubscription(db, testTenantId, 30);

    const sub = await db.selectFrom('tenant_subscriptions')
      .where('id', '=', subId)
      .selectAll()
      .executeTakeFirst();

    expect(sub?.status).toBe('ACTIVE');
  });

  it('debería renovar una suscripción activa', async () => {
    const subId = await SubscriptionService.createSubscription(db, testTenantId, 'PRO', 'TRIAL', 14);
    await SubscriptionService.activateSubscription(db, testTenantId, 30);

    const subBefore = await db.selectFrom('tenant_subscriptions')
      .where('id', '=', subId)
      .select('current_period_end')
      .executeTakeFirst();

    await SubscriptionService.renewSubscription(db, testTenantId, 30);

    const subAfter = await db.selectFrom('tenant_subscriptions')
      .where('id', '=', subId)
      .select('current_period_end')
      .executeTakeFirst();

    const beforeTime = subBefore?.current_period_end.getTime() || 0;
    const afterTime = subAfter?.current_period_end.getTime() || 0;

    // Aproximadamente 30 días en ms: 30 * 24 * 60 * 60 * 1000 = 2592000000
    expect(afterTime - beforeTime).toBe(2592000000);
  });
});
