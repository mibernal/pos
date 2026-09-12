import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  cleanupE2eFixture,
  ensureE2eSchema,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';
import { ChangeTenantPlanUseCase } from '../src/contexts/platform-admin/application/tenants/change-tenant-plan.use-case.js';
import { chargeSubscription } from '../src/contexts/billing/application/recurring/charge-subscription.js';
import { MockGateway } from '../src/contexts/billing/domain/mock-gateway.js';

/**
 * Lo que se le enseña al comercio antes de aceptar es lo que pasa después.
 *
 * `/plan/preview` calculaba el prorrateo —crédito por lo no usado, cargo por la diferencia,
 * nuevo fin de periodo— y `ChangeTenantPlanUseCase` no aplicaba nada: cambiaba `plan_id` y
 * se iba. El número que veía el cliente era una simulación que no ocurría.
 *
 * Esta prueba comprueba las tres mitades del arreglo: que el fin de periodo se mueve, que
 * la diferencia queda apuntada, y —la que de verdad importa en un motor que corre cada
 * hora— que esa diferencia se cobra **una sola vez**.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
const DIA = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await ensureE2eSchema();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  for (const fixture of fixtures.reverse()) {
    await cleanupE2eFixture(app, fixture);
  }
  await app.close();
});

async function suscripcionConPeriodoAbierto(tenantId: string, finDePeriodo: Date) {
  await adminDb()
    .updateTable('tenant_subscriptions')
    .set({
      status: 'ACTIVE',
      plan_id: 'STARTER',
      auto_renew: true,
      current_period_start: new Date(finDePeriodo.getTime() - 30 * DIA),
      current_period_end: finDePeriodo,
      next_billing_at: finDePeriodo,
      trial_ends_at: null
    })
    .where('tenant_id', '=', tenantId)
    .execute();

  return adminDb()
    .selectFrom('tenant_subscriptions')
    .select(['id', 'current_period_end'])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirstOrThrow();
}

describe('El prorrateo del cambio de plan se aplica', () => {
  it('mueve el fin de periodo y deja la diferencia apuntada, no perdida', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const finOriginal = new Date(Date.now() + 20 * DIA);
    const sub = await suscripcionConPeriodoAbierto(fixture.tenantId, finOriginal);

    await new ChangeTenantPlanUseCase(app.db).execute(
      fixture.tenantId,
      'PRO',
      fixture.adminUserId,
      fixture.adminEmail
    );

    const despues = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'current_period_end'])
      .where('id', '=', sub.id)
      .executeTakeFirstOrThrow();

    expect(despues.plan_id).toBe('PRO');

    // Subir de plan compra menos días con el mismo crédito: el periodo se acorta.
    expect(new Date(despues.current_period_end!).getTime()).toBeLessThan(finOriginal.getTime());

    const pendientes = await adminDb()
      .selectFrom('subscription_pending_charges')
      .select(['amount_cents', 'applied_invoice_id'])
      .where('subscription_id', '=', sub.id)
      .execute();

    // Puede haber cargo o no según los precios sembrados; lo que no puede es haberse
    // cobrado ya, ni existir con importe cero.
    for (const cargo of pendientes) {
      expect(cargo.amount_cents).toBeGreaterThan(0);
      expect(cargo.applied_invoice_id).toBeNull();
    }
  }, 60_000);

  it('la diferencia entra en la siguiente factura, y solo en una', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    const sub = await suscripcionConPeriodoAbierto(fixture.tenantId, new Date(Date.now() + 20 * DIA));

    // Un cargo pendiente, puesto a mano para no depender de los precios sembrados.
    await adminDb()
      .insertInto('subscription_pending_charges')
      .values({
        id: crypto.randomUUID(),
        tenant_id: fixture.tenantId,
        subscription_id: sub.id,
        description: 'Ajuste por cambio a PRO',
        amount_cents: 17_500
      })
      .execute();

    const ahora = new Date();
    const deps = { db: app.db, gateway: new MockGateway(), now: () => ahora };

    await chargeSubscription(deps, sub.id, 'RENEWAL');

    const lineas = await adminDb()
      .selectFrom('subscription_invoice_items')
      .innerJoin(
        'subscription_invoices',
        'subscription_invoices.id',
        'subscription_invoice_items.invoice_id'
      )
      .select(['subscription_invoice_items.description', 'subscription_invoice_items.unit_price_cents'])
      .where('subscription_invoices.subscription_id', '=', sub.id)
      .execute();

    const ajustes = lineas.filter((l) => l.description === 'Ajuste por cambio a PRO');
    expect(ajustes).toHaveLength(1);
    expect(ajustes[0]!.unit_price_cents).toBe(17_500);

    const cargo = await adminDb()
      .selectFrom('subscription_pending_charges')
      .select(['applied_invoice_id'])
      .where('subscription_id', '=', sub.id)
      .executeTakeFirstOrThrow();

    // Queda atado a su factura: es lo que impide que el motor lo vuelva a añadir.
    expect(cargo.applied_invoice_id).not.toBeNull();

    // Y el motor corre otra vez, como corre de verdad: ni una línea más.
    await chargeSubscription(deps, sub.id, 'RENEWAL').catch(() => undefined);

    const lineasDespues = await adminDb()
      .selectFrom('subscription_invoice_items')
      .innerJoin(
        'subscription_invoices',
        'subscription_invoices.id',
        'subscription_invoice_items.invoice_id'
      )
      .select(['subscription_invoice_items.description'])
      .where('subscription_invoices.subscription_id', '=', sub.id)
      .execute();

    expect(
      lineasDespues.filter((l) => l.description === 'Ajuste por cambio a PRO')
    ).toHaveLength(1);
  }, 60_000);
});
