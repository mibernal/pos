import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { adminDb, cleanupE2eFixture, ensureE2eSchema, seedE2eFixture, type E2eFixture } from './helpers/e2e-fixture.js';

/**
 * Webhooks de pago, contra PostgreSQL real y con firmas calculadas como las calcula Wompi.
 *
 * Las tres rutas respondían 200 a todo —firma inválida incluida— «para evitar reintentos
 * infinitos maliciosos». El razonamiento vale para la firma y no vale para nada más: un
 * fallo nuestro mientras se procesa un pago aprobado se daba por entregado y el cobro se
 * perdía sin dejar rastro. Y el importe cobrado no se contrastaba nunca contra el de la
 * transacción: la firma prueba el origen del mensaje, no la cifra.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
const createdPlans: string[] = [];

const WOMPI_EVENTS_KEY = process.env.WOMPI_EVENTS_KEY || 'events_test_XXXX';

/** Construye un evento de Wompi con su checksum correcto (o deliberadamente roto). */
function wompiEvent(options: {
  reference: string;
  amountInCents: number;
  status?: string;
  transactionId?: string;
  breakSignature?: boolean;
}) {
  const transaction = {
    id: options.transactionId ?? randomUUID(),
    status: options.status ?? 'APPROVED',
    reference: options.reference,
    amount_in_cents: options.amountInCents,
    currency: 'COP'
  };

  const timestamp = Math.floor(Date.now() / 1000);
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];

  const concatenated =
    `${transaction.id}${transaction.status}${transaction.amount_in_cents}${timestamp}${WOMPI_EVENTS_KEY}`;
  const checksum = createHash('sha256').update(concatenated).digest('hex');

  return {
    event: 'transaction.updated',
    data: { transaction },
    timestamp,
    signature: {
      properties,
      checksum: options.breakSignature ? 'checksum-que-no-corresponde' : checksum
    }
  };
}

async function seedTransaction(tenantId: string, planId: string, amountCents: number) {
  const reference = `SUB_${tenantId}_${randomUUID()}`;

  await adminDb()
    .insertInto('payment_transactions')
    .values({
      id: randomUUID(),
      tenant_id: tenantId,
      amount_cents: amountCents,
      currency: 'COP',
      gateway: 'WOMPI',
      gateway_reference: reference,
      status: 'PENDING',
      metadata_json: { planId, checkoutUrl: 'https://checkout.wompi.co/p/x', autoRenew: false } as never
    })
    .execute();

  return reference;
}

function postWompi(payload: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/payments/wompi',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload)
  });
}

describe('Webhooks de pago', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();

    // Un plan anual propio, para comprobar que el periodo sale del ciclo del plan.
    await adminDb()
      .insertInto('billing_plans')
      .values({
        id: 'TEST_ANUAL',
        name: 'Plan Anual de Prueba',
        price_cents: 50000000,
        billing_cycle: 'YEARLY',
        features_json: { users: 10, branches: 3 } as never,
        active: true
      })
      .execute();
    createdPlans.push('TEST_ANUAL');
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await adminDb().deleteFrom('payment_transactions').where('tenant_id', '=', fixture.tenantId).execute();
      await cleanupE2eFixture(app, fixture);
    }
    await adminDb().deleteFrom('payment_webhook_events').where('gateway', '=', 'WOMPI').execute();
    for (const planId of createdPlans) {
      await adminDb().deleteFrom('billing_plans').where('id', '=', planId).execute();
    }
    await app.close();
  });

  it('una firma inválida responde 400 y queda registrada', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const reference = await seedTransaction(fixture.tenantId, 'STARTER', 4990000);
    const response = await postWompi(wompiEvent({ reference, amountInCents: 4990000, breakSignature: true }));

    expect(response.statusCode).toBe(400);

    const tx = await adminDb()
      .selectFrom('payment_transactions')
      .select('status')
      .where('gateway_reference', '=', reference)
      .executeTakeFirst();

    expect(tx?.status).toBe('PENDING');

    const logged = await adminDb()
      .selectFrom('payment_webhook_events')
      .select(['status', 'signature_valid'])
      .where('gateway', '=', 'WOMPI')
      .orderBy('received_at', 'desc')
      .executeTakeFirst();

    expect(logged?.status).toBe('REJECTED');
    expect(logged?.signature_valid).toBe(false);
  });

  it('un importe distinto al de la transacción no concede el plan', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const reference = await seedTransaction(fixture.tenantId, 'PRO', 9990000);

    // Firma válida, importe que no corresponde: exactamente lo que la firma no cubre.
    const response = await postWompi(wompiEvent({ reference, amountInCents: 100 }));

    expect(response.statusCode).toBe(400);

    const tx = await adminDb()
      .selectFrom('payment_transactions')
      .select('status')
      .where('gateway_reference', '=', reference)
      .executeTakeFirst();

    expect(tx?.status).toBe('PENDING');

    const subscription = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select('plan_id')
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirst();

    expect(subscription?.plan_id).toBe('STARTER');
  });

  it('una referencia que no es nuestra se ignora con 200', async () => {
    const response = await postWompi(wompiEvent({ reference: `SUB_${randomUUID()}_ajena`, amountInCents: 1000 }));
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('ignored');
  });

  it('un pago anual concede 365 días, no 30', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const reference = await seedTransaction(fixture.tenantId, 'TEST_ANUAL', 50000000);
    const response = await postWompi(wompiEvent({ reference, amountInCents: 50000000 }));

    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('processed');

    const subscription = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'status', 'current_period_end'])
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirst();

    expect(subscription?.plan_id).toBe('TEST_ANUAL');
    expect(subscription?.status).toBe('ACTIVE');

    const days = Math.round(
      (new Date(subscription!.current_period_end).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );

    // La fixture nace ACTIVE, así que se renueva sumando al periodo vigente: 30 que le
    // quedaban más los 365 del ciclo anual. Lo que importa es que no sean 30 ni 60.
    expect(days).toBeGreaterThan(360);
  });

  it('el mismo evento reenviado no se aplica dos veces', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const reference = await seedTransaction(fixture.tenantId, 'STARTER', 4990000);
    const event = wompiEvent({ reference, amountInCents: 4990000 });

    const first = await postWompi(event);
    expect(first.statusCode).toBe(200);
    expect(first.json().outcome).toBe('processed');

    const firstEnd = (
      await adminDb()
        .selectFrom('tenant_subscriptions')
        .select('current_period_end')
        .where('tenant_id', '=', fixture.tenantId)
        .executeTakeFirst()
    )?.current_period_end;

    const second = await postWompi(event);
    expect(second.statusCode).toBe(200);
    expect(second.json().outcome).toBe('duplicate');

    const secondEnd = (
      await adminDb()
        .selectFrom('tenant_subscriptions')
        .select('current_period_end')
        .where('tenant_id', '=', fixture.tenantId)
        .executeTakeFirst()
    )?.current_period_end;

    // Si el reintento se hubiera aplicado, el periodo habría crecido otro mes.
    expect(new Date(secondEnd!).getTime()).toBe(new Date(firstEnd!).getTime());
  });
});
