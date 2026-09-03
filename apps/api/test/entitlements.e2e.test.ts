import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  grantModules,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';
import { EntitlementsResolver } from '../src/shared/infra/entitlements/entitlements-resolver.js';
import { EntitlementGuard } from '../src/shared/infra/entitlements/entitlement-guard.js';

/**
 * El plan gobierna el producto.
 *
 * Antes, precio y capacidades eran dos sistemas independientes: el plan limitaba usuarios y
 * sucursales y nada más, y los módulos se encendían a mano por comercio. Estas pruebas fijan
 * las tres propiedades de la fase 7 — los módulos salen del plan, los límites se cuentan sin
 * carreras, y la mora degrada sin apagar la caja — contra PostgreSQL real.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
const createdPlans: string[] = [];

function resolver() {
  // Sin Redis: cada llamada lee la base y la prueba no depende de invalidaciones.
  return new EntitlementsResolver(adminDb());
}

async function seedPlan(id: string, priceCents: number, limits: Record<string, number>, modules: string[]) {
  await adminDb()
    .insertInto('billing_plans')
    .values({
      id,
      name: `Plan ${id}`,
      price_cents: priceCents,
      billing_cycle: 'MONTHLY',
      features_json: {} as never,
      active: true
    })
    .execute();
  createdPlans.push(id);

  for (const [key, value] of Object.entries(limits)) {
    await adminDb()
      .insertInto('plan_entitlements')
      .values({ plan_id: id, entitlement_key: key, limit_value: value })
      .execute();
  }

  if (modules.length > 0) {
    await adminDb()
      .insertInto('plan_modules')
      .values(modules.map((module) => ({ plan_id: id, module })))
      .execute();
  }
}

async function setPlan(tenantId: string, planId: string) {
  await adminDb()
    .updateTable('tenant_subscriptions')
    .set({ plan_id: planId })
    .where('tenant_id', '=', tenantId)
    .execute();
}

describe('El plan gobierna el producto', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();

    await seedPlan('TEST_BASICO', 1000000, { users: 2, branches: 1, tables: 0 }, ['inventory']);
    await seedPlan('TEST_COMPLETO', 5000000, { users: 20, branches: 10, tables: 50 }, [
      'inventory',
      'tables',
      'waiters',
      'tips'
    ]);
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await adminDb().deleteFrom('tenant_module_overrides').where('tenant_id', '=', fixture.tenantId).execute();
      await adminDb().deleteFrom('tenant_limit_overrides').where('tenant_id', '=', fixture.tenantId).execute();
      await cleanupE2eFixture(app, fixture);
    }
    for (const planId of createdPlans) {
      await adminDb().deleteFrom('plan_modules').where('plan_id', '=', planId).execute();
      await adminDb().deleteFrom('plan_entitlements').where('plan_id', '=', planId).execute();
      await adminDb().deleteFrom('billing_plans').where('id', '=', planId).execute();
    }
    await app.close();
  });

  it('el plan decide los módulos, sin tocar ninguna columna del comercio', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_COMPLETO');

    const entitlements = await resolver().resolve(fixture.tenantId);

    expect(entitlements.modules.sort()).toEqual(['inventory', 'tables', 'tips', 'waiters']);
    expect(entitlements.limits.users).toBe(20);
  });

  it('subir de plan habilita el módulo en la siguiente petición, sin cerrar sesión', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_BASICO');

    const token = await loginE2eUser(app, { email: fixture.adminEmail, password: fixture.adminPassword });

    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token)
    });
    expect(before.statusCode).toBe(403);
    expect(before.json().error.code).toBe('MODULE_DISABLED');

    await setPlan(fixture.tenantId, 'TEST_COMPLETO');
    await app.entitlements.invalidate(fixture.tenantId);

    // El mismo token de antes. Mientras los módulos viajaban firmados en el JWT, esto
    // exigía cerrar sesión y volver a entrar.
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token)
    });
    expect(after.statusCode).toBe(200);
  });

  it('una excepción concede un módulo que el plan no incluye, y revocarla lo quita', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_BASICO');

    await grantModules(fixture.tenantId, ['tables']);
    expect((await resolver().resolve(fixture.tenantId)).modules).toContain('tables');

    await adminDb()
      .updateTable('tenant_module_overrides')
      .set({ enabled: false })
      .where('tenant_id', '=', fixture.tenantId)
      .where('module', '=', 'tables')
      .execute();

    expect((await resolver().resolve(fixture.tenantId)).modules).not.toContain('tables');
  });

  it('una excepción caducada deja de contar', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_BASICO');

    await adminDb()
      .insertInto('tenant_module_overrides')
      .values({
        tenant_id: fixture.tenantId,
        module: 'tables',
        enabled: true,
        reason: 'Cortesía comercial vencida',
        expires_at: new Date(Date.now() - 60_000)
      })
      .execute();

    expect((await resolver().resolve(fixture.tenantId)).modules).not.toContain('tables');
  });

  it('el límite de un comercio se puede subir sin cambiarle el plan', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_BASICO');

    expect((await resolver().resolve(fixture.tenantId)).limits.users).toBe(2);

    await adminDb()
      .insertInto('tenant_limit_overrides')
      .values({
        tenant_id: fixture.tenantId,
        entitlement_key: 'users',
        limit_value: 25,
        reason: 'Acuerdo comercial con el cliente',
        expires_at: null
      })
      .execute();

    expect((await resolver().resolve(fixture.tenantId)).limits.users).toBe(25);
  });

  it('dos creaciones simultáneas no rebasan la cuota', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    // La fixture crea 2 usuarios; con un límite de 3 queda sitio para exactamente uno más.
    await setPlan(fixture.tenantId, 'TEST_COMPLETO');
    await adminDb()
      .insertInto('tenant_limit_overrides')
      .values({
        tenant_id: fixture.tenantId,
        entitlement_key: 'users',
        limit_value: 3,
        reason: 'Prueba de concurrencia',
        expires_at: null
      })
      .execute();

    const guard = new EntitlementGuard(resolver());

    /** Comprueba la cuota y crea, todo dentro de la misma transacción. */
    const createUser = () =>
      adminDb()
        .transaction()
        .execute(async (trx) => {
          await guard.assertCanCreate(trx, fixture.tenantId, 'users');
          await trx
            .insertInto('users')
            .values({
              id: randomUUID(),
              tenant_id: fixture.tenantId,
              email: `carrera-${randomUUID()}@ejemplo.com`,
              password_hash: 'x'.repeat(20),
              name: 'Carrera',
              role: 'CASHIER',
              active: true
            })
            .execute();
        });

    // El guard anterior contaba fuera de la transacción: las dos veían dos usuarios y las
    // dos pasaban, dejando el comercio con cuatro en un plan de tres.
    const results = await Promise.allSettled([createUser(), createUser()]);

    const created = results.filter((r) => r.status === 'fulfilled').length;
    expect(created).toBe(1);

    const { count } = await adminDb()
      .selectFrom('users')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', fixture.tenantId)
      .where('active', '=', true)
      .executeTakeFirstOrThrow();

    expect(Number(count)).toBe(3);
  });

  it('en mora se sigue vendiendo, pero no se entra al backoffice', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_COMPLETO');

    await adminDb()
      .updateTable('tenant_subscriptions')
      .set({ status: 'PAST_DUE' })
      .where('tenant_id', '=', fixture.tenantId)
      .execute();
    await app.entitlements.invalidate(fixture.tenantId);

    const token = await loginE2eUser(app, { email: fixture.cashierEmail, password: fixture.cashierPassword });

    // La caja sigue: el cajero puede consultar sus ventas.
    const sales = await app.inject({
      method: 'GET',
      url: `/api/v1/sales?branch_id=${fixture.branchId}`,
      headers: bearerHeaders(token)
    });
    expect(sales.statusCode).toBe(200);

    // El backoffice no: los informes esperan a que se ponga al día.
    const reports = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/sales?branch_id=${fixture.branchId}`,
      headers: bearerHeaders(token)
    });
    expect(reports.statusCode).toBe(403);
    expect(reports.json().error.code).toBe('SUBSCRIPTION_PAST_DUE');
  });

  it('la vista previa del cambio de plan dice qué se pierde y qué queda corto', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await setPlan(fixture.tenantId, 'TEST_COMPLETO');

    const { PreviewPlanChangeUseCase } = await import(
      '../src/contexts/platform-admin/application/tenants/preview-plan-change.use-case.js'
    );

    const preview = await new PreviewPlanChangeUseCase(adminDb(), resolver()).execute(
      fixture.tenantId,
      'TEST_BASICO'
    );

    expect(preview.direction).toBe('DOWNGRADE');
    expect(preview.modules_lost.sort()).toEqual(['tables', 'tips', 'waiters']);

    // La fixture tiene 2 usuarios y TEST_BASICO admite 2: no sobra ninguno. La sucursal sí
    // cabe (1 de 1). Lo que importa es que la vista previa lo calcula antes de tocar nada.
    expect(preview.limits_over_quota.map((l) => l.key)).not.toContain('branches');
    expect(preview.proration.unused_days).toBeGreaterThanOrEqual(0);
  });
});
