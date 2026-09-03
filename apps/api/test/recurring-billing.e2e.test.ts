import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';
import { RenewalEngine } from '../src/contexts/billing/application/renewal-engine.js';
import { chargeSubscription } from '../src/contexts/billing/application/recurring/charge-subscription.js';
import { MockGateway } from '../src/contexts/billing/domain/mock-gateway.js';
import { computeInvoiceAmounts } from '@pos-dian/shared';

/**
 * El cobro recurrente, con el reloj adelantado.
 *
 * Es el criterio de salida de la fase 8, escrito como prueba: una suscripción llega a su
 * vencimiento y se cobra sola; un cobro rechazado recorre los reintentos, avisa, degrada y
 * suspende sin que nadie intervenga.
 *
 * Corre contra PostgreSQL de verdad y **con la conexión de la app**, que usa el rol
 * restringido sin BYPASSRLS. Eso no es un detalle: las tablas de facturación llevan RLS con
 * `FORCE`, así que una escritura fuera de contexto de comercio falla aquí igual que
 * fallaría en producción. Con la conexión administrativa la prueba pasaría en verde y el
 * motor no cobraría nada el día del despliegue.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Base de tiempo fija: el ciclo entero se ensaya moviendo este reloj, no esperando. */
const T0 = new Date('2026-06-15T12:00:00.000Z');

function deps(now: Date) {
  return { db: app.db, gateway: new MockGateway(), now: () => now };
}

async function newTenant() {
  const fixture = await seedE2eFixture(app);
  fixtures.push(fixture);
  return fixture;
}

/** Deja la suscripción activa y vencida hoy, que es el estado del día del cobro. */
async function makeDueSubscription(tenantId: string, periodEnd: Date) {
  const periodStart = new Date(periodEnd.getTime() - 30 * DAY);

  await adminDb()
    .updateTable('tenant_subscriptions')
    .set({
      status: 'ACTIVE',
      plan_id: 'STARTER',
      auto_renew: true,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      next_billing_at: periodEnd,
      trial_ends_at: null,
      retry_count: 0,
      next_retry_at: null,
      dunning_stage: null,
      max_retries: 3,
      grace_period_days: 7
    })
    .where('tenant_id', '=', tenantId)
    .execute();

  const sub = await adminDb()
    .selectFrom('tenant_subscriptions')
    .select(['id'])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirstOrThrow();

  return sub.id;
}

/** Registra el medio de pago por la API real; `cardToken` decide qué hará la pasarela. */
async function registerCard(fixture: E2eFixture, cardToken: string) {
  const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/billing/payment-methods',
    headers: bearerHeaders(token),
    payload: {
      gateway: 'MOCK',
      card_token: cardToken,
      acceptance_token: 'accept_mock',
      make_default: true
    }
  });

  expect(response.statusCode).toBe(201);
  return token;
}

async function subscription(tenantId: string) {
  return adminDb()
    .selectFrom('tenant_subscriptions')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .executeTakeFirstOrThrow();
}

async function invoices(tenantId: string) {
  return adminDb()
    .selectFrom('subscription_invoices')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .orderBy('issued_at', 'asc')
    .execute();
}

async function dunningSteps(tenantId: string): Promise<string[]> {
  const rows = await adminDb()
    .selectFrom('dunning_events')
    .select(['step'])
    .where('tenant_id', '=', tenantId)
    .orderBy('occurred_at', 'asc')
    .execute();

  return rows.map((row) => row.step);
}

describe('El cobro recurrente ocurre solo', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    for (const fixture of fixtures) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('cobra la renovación por sí sola y deja la factura pagada', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));
    await registerCard(fixture, 'tok_ok');

    const results = await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    expect(results.renewals).toBeGreaterThanOrEqual(1);

    const emitidas = await invoices(fixture.tenantId);
    expect(emitidas).toHaveLength(1);

    const factura = emitidas[0]!;
    expect(factura.status).toBe('PAID');
    expect(factura.paid_at).not.toBeNull();
    expect(factura.number).toMatch(/^POS-\d{6}$/);

    // El IVA sale desglosado y el total cuadra con el desglose, que es lo que exige el
    // CHECK de la tabla y lo que espera cualquier contador.
    const esperado = computeInvoiceAmounts(4990000, null, 0.19);
    expect(factura.subtotal_cents).toBe(esperado.subtotalCents);
    expect(factura.tax_cents).toBe(esperado.taxCents);
    expect(factura.total_cents).toBe(esperado.totalCents);
    expect(factura.total_cents).toBe(factura.subtotal_cents - factura.discount_cents + factura.tax_cents);

    const sub = await subscription(fixture.tenantId);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.retry_count).toBe(0);
    // El periodo nuevo empieza donde terminó el anterior, no «hoy»: si no, cada cobro con
    // retraso le corre el aniversario al comercio.
    expect(sub.current_period_start?.toISOString()).toBe(factura.period_start.toISOString());
    expect(sub.next_billing_at?.toISOString()).toBe(factura.period_end.toISOString());

    const pasos = await dunningSteps(fixture.tenantId);
    expect(pasos).toContain('CHARGE_ATTEMPTED');
    expect(pasos).toContain('CHARGE_SUCCEEDED');

    const cobro = await adminDb()
      .selectFrom('payment_transactions')
      .selectAll()
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();

    expect(cobro.status).toBe('APPROVED');
    expect(cobro.amount_cents).toBe(factura.total_cents);
    expect(cobro.idempotency_key).toBe(`${factura.number}:1`);
  }, 60_000);

  it('no cobra dos veces si el motor corre otra vez el mismo día', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));
    await registerCard(fixture, 'tok_ok');

    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });
    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    expect(await invoices(fixture.tenantId)).toHaveLength(1);

    const cobros = await adminDb()
      .selectFrom('payment_transactions')
      .select(['id'])
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    expect(cobros).toHaveLength(1);
  }, 60_000);

  it('serializa dos cobros simultáneos sobre la misma suscripción', async () => {
    const fixture = await newTenant();
    const subscriptionId = await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));
    await registerCard(fixture, 'tok_ok');

    // Es la carrera que el `skipLocked` anterior no cubría: soltaba el lock en el commit y
    // dos instancias del worker reclamaban la misma suscripción.
    const [uno, dos] = await Promise.all([
      chargeSubscription(deps(T0), subscriptionId, 'RENEWAL'),
      chargeSubscription(deps(T0), subscriptionId, 'RENEWAL')
    ]);

    const desenlaces = [uno.outcome, dos.outcome].sort();
    expect(desenlaces).toEqual(['charged', 'skipped']);

    const cobros = await adminDb()
      .selectFrom('payment_transactions')
      .select(['id'])
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    expect(cobros).toHaveLength(1);
  }, 60_000);

  it('recorre los reintentos con espera creciente, degrada y avisa una sola vez por paso', async () => {
    const fixture = await newTenant();
    const vencimiento = new Date(T0.getTime() - DAY);
    await makeDueSubscription(fixture.tenantId, vencimiento);
    await registerCard(fixture, 'tok_DECLINE');

    /* --- Cobro del día: rechazado --- */
    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    let sub = await subscription(fixture.tenantId);
    expect(sub.status).toBe('PAST_DUE');
    expect(sub.retry_count).toBe(1);
    expect(sub.dunning_stage).toBe('RETRYING');

    // 24 horas hasta el primer reintento. Un rechazo por fondos no se resuelve en una hora.
    expect(sub.next_retry_at!.getTime() - T0.getTime()).toBe(24 * HOUR);

    let pasos = await dunningSteps(fixture.tenantId);
    expect(pasos).toContain('CHARGE_FAILED');
    expect(pasos).toContain('GRACE_STARTED');
    expect(pasos).toContain('DEGRADED');
    expect(pasos).toContain('RETRY_SCHEDULED');

    // La factura sigue abierta: lo que falló fue el cobro, no la emisión.
    const abiertas = await invoices(fixture.tenantId);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0]!.status).toBe('OPEN');
    expect(abiertas[0]!.attempt_count).toBe(1);

    /* --- Antes de tiempo no se reintenta --- */
    const antes = new Date(T0.getTime() + 2 * HOUR);
    expect(await RenewalEngine.processRetries({ db: app.db, gateway: new MockGateway(), now: () => antes })).toBe(0);

    /* --- Reintento 1, a las 24 h: 72 h hasta el siguiente --- */
    const t1 = new Date(T0.getTime() + 25 * HOUR);
    await RenewalEngine.processRetries({ db: app.db, gateway: new MockGateway(), now: () => t1 });

    sub = await subscription(fixture.tenantId);
    expect(sub.retry_count).toBe(2);
    expect(sub.next_retry_at!.getTime() - t1.getTime()).toBe(72 * HOUR);

    /* --- Reintento 2, a las 72 h: una semana hasta el último --- */
    const t2 = new Date(t1.getTime() + 73 * HOUR);
    await RenewalEngine.processRetries({ db: app.db, gateway: new MockGateway(), now: () => t2 });

    sub = await subscription(fixture.tenantId);
    expect(sub.retry_count).toBe(3);
    expect(sub.next_retry_at!.getTime() - t2.getTime()).toBe(168 * HOUR);

    /* --- Reintento 3: se agota la cobranza --- */
    const t3 = new Date(t2.getTime() + 169 * HOUR);
    await RenewalEngine.processRetries({ db: app.db, gateway: new MockGateway(), now: () => t3 });

    sub = await subscription(fixture.tenantId);
    expect(sub.retry_count).toBe(4);
    expect(sub.next_retry_at).toBeNull();
    expect(sub.dunning_stage).toBe('GIVEN_UP');

    pasos = await dunningSteps(fixture.tenantId);
    expect(pasos).toContain('GIVEN_UP');

    // Cuatro intentos en total —el del día más tres reintentos— y ni un aviso repetido:
    // el paso de degradación se registra una vez aunque el motor haya corrido cinco veces.
    expect(pasos.filter((paso) => paso === 'CHARGE_ATTEMPTED')).toHaveLength(4);
    expect(pasos.filter((paso) => paso === 'DEGRADED')).toHaveLength(1);
    expect(pasos.filter((paso) => paso === 'GRACE_STARTED')).toHaveLength(1);

    /* --- Y suspende cuando se acaba la gracia --- */
    const tSuspension = new Date(vencimiento.getTime() + 8 * DAY);
    const suspendidas = await RenewalEngine.processSuspensions({
      db: app.db,
      gateway: new MockGateway(),
      now: () => tSuspension
    });

    expect(suspendidas).toBeGreaterThanOrEqual(1);

    sub = await subscription(fixture.tenantId);
    expect(sub.status).toBe('SUSPENDED');
    expect(sub.suspended_at).not.toBeNull();

    const tenant = await adminDb()
      .selectFrom('tenants')
      .select(['status'])
      .where('id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();
    expect(tenant.status).toBe('SUSPENDED');

    // La factura no se anula: se marca incobrable. Anularla borraría que se intentó cobrar
    // cuatro veces, que es justo lo que hay que poder demostrar.
    const finales = await invoices(fixture.tenantId);
    expect(finales[0]!.status).toBe('UNCOLLECTIBLE');

    expect(await dunningSteps(fixture.tenantId)).toContain('SUSPENDED');
  }, 120_000);

  it('degrada sin cobrar cuando no hay medio de pago y deja la factura para pagar a mano', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));

    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    const sub = await subscription(fixture.tenantId);
    expect(sub.status).toBe('PAST_DUE');
    expect(sub.dunning_stage).toBe('NO_PAYMENT_METHOD');

    const emitidas = await invoices(fixture.tenantId);
    expect(emitidas).toHaveLength(1);
    expect(emitidas[0]!.status).toBe('OPEN');

    const pasos = await dunningSteps(fixture.tenantId);
    expect(pasos).toContain('GRACE_STARTED');
    expect(pasos).toContain('DEGRADED');
    // Sin tarjeta no hay nada que intentar contra la pasarela.
    expect(pasos).not.toContain('CHARGE_ATTEMPTED');
  }, 60_000);

  it('avisa antes de cobrar, a los 7 y a los 3 días, y no repite el aviso', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() + 7 * DAY));
    await registerCard(fixture, 'tok_ok');

    const engine = { db: app.db, gateway: new MockGateway(), now: () => T0 };

    expect(await RenewalEngine.processUpcomingExpirations(engine)).toBeGreaterThanOrEqual(1);
    // Segunda pasada del mismo día: el scheduler corre varias veces y el comercio recibe
    // un solo correo.
    expect(await RenewalEngine.processUpcomingExpirations(engine)).toBe(0);

    let pasos = await dunningSteps(fixture.tenantId);
    expect(pasos.filter((paso) => paso === 'NOTICE_7')).toHaveLength(1);
    expect(pasos).not.toContain('NOTICE_3');

    const cuatroDiasDespues = new Date(T0.getTime() + 4 * DAY);
    await RenewalEngine.processUpcomingExpirations({ ...engine, now: () => cuatroDiasDespues });

    pasos = await dunningSteps(fixture.tenantId);
    expect(pasos.filter((paso) => paso === 'NOTICE_3')).toHaveLength(1);
  }, 60_000);

  it('aplica el cupón antes del IVA y lo consume al pagar', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));
    const token = await registerCard(fixture, 'tok_ok');

    const code = `PRUEBA${Date.now().toString().slice(-6)}`;
    await adminDb()
      .insertInto('billing_coupons')
      .values({ code, type: 'PERCENT', value: 20, duration: 'REPEATING', duration_periods: 2, active: true })
      .execute();

    const canje = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/coupons/redeem',
      headers: bearerHeaders(token),
      payload: { code }
    });
    expect(canje.statusCode).toBe(200);
    expect(canje.json().periods).toBe(2);

    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    const factura = (await invoices(fixture.tenantId))[0]!;
    const esperado = computeInvoiceAmounts(4990000, { type: 'PERCENT', value: 20 }, 0.19);

    expect(factura.coupon_code).toBe(code);
    expect(factura.discount_cents).toBe(esperado.discountCents);
    // El IVA se calcula sobre la base ya descontada, no sobre el precio de lista.
    expect(factura.tax_cents).toBe(esperado.taxCents);
    expect(factura.total_cents).toBe(esperado.totalCents);

    const sub = await subscription(fixture.tenantId);
    expect(sub.coupon_periods_left).toBe(1);

    await adminDb().deleteFrom('tenant_coupon_redemptions').where('coupon_code', '=', code).execute();
    await adminDb().deleteFrom('billing_coupons').where('code', '=', code).execute();
  }, 60_000);

  it('el portal muestra plan, consumo y facturas, y solo las del propio comercio', async () => {
    const propio = await newTenant();
    const ajeno = await newTenant();

    await makeDueSubscription(propio.tenantId, new Date(T0.getTime() - DAY));
    await makeDueSubscription(ajeno.tenantId, new Date(T0.getTime() - DAY));
    await registerCard(propio, 'tok_ok');
    await registerCard(ajeno, 'tok_ok');

    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });

    const token = await loginE2eUser(app, { email: propio.adminEmail, password: propio.adminPassword });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/portal',
      headers: bearerHeaders(token)
    });

    expect(response.statusCode).toBe(200);
    const portal = response.json();

    expect(portal.subscription.plan_id).toBe('STARTER');
    expect(portal.subscription.service_level).toBe('FULL');
    expect(portal.payment_method.last_four).toBe('4242');
    // El token con el que se cobra no sale nunca hacia el navegador.
    expect(portal.payment_method).not.toHaveProperty('gateway_token');
    expect(portal.usage.find((fila: { key: string }) => fila.key === 'users')).toBeDefined();

    expect(portal.invoices).toHaveLength(1);

    const facturasAjenas = await invoices(ajeno.tenantId);
    expect(facturasAjenas).toHaveLength(1);
    // RLS, no un `where` bien escrito: la conexión de la app no puede ver la factura del
    // otro comercio ni queriendo.
    expect(portal.invoices.map((f: { id: string }) => f.id)).not.toContain(facturasAjenas[0]!.id);

    const detalle = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/invoices/${facturasAjenas[0]!.id}`,
      headers: bearerHeaders(token)
    });
    expect(detalle.statusCode).toBe(404);
  }, 90_000);

  it('cobra al instante cuando el comercio arregla la tarjeta y pide cobrar ahora', async () => {
    const fixture = await newTenant();
    await makeDueSubscription(fixture.tenantId, new Date(T0.getTime() - DAY));

    // Primero falla por no tener tarjeta: queda en mora con la factura abierta.
    await RenewalEngine.runAll(app.db, { gateway: new MockGateway(), now: () => T0 });
    expect((await subscription(fixture.tenantId)).status).toBe('PAST_DUE');

    const token = await registerCard(fixture, 'tok_ok');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/pay-now',
      headers: bearerHeaders(token)
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('charged');

    const sub = await subscription(fixture.tenantId);
    expect(sub.status).toBe('ACTIVE');

    // Se cobra la factura que ya estaba abierta; no se emite una segunda.
    const emitidas = await invoices(fixture.tenantId);
    expect(emitidas).toHaveLength(1);
    expect(emitidas[0]!.status).toBe('PAID');

    expect(await dunningSteps(fixture.tenantId)).toContain('RECOVERED');
  }, 60_000);
});
