import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import { adminDb, cleanupE2eFixture, ensureE2eSchema, seedE2eFixture, type E2eFixture } from './helpers/e2e-fixture.js';
import { CreateTenantUseCase } from '../src/contexts/platform-admin/application/tenants/create-tenant.use-case.js';
import { QuotaGuard } from '../src/shared/infra/security/quota-guard.js';
import { SubscriptionService } from '../src/contexts/billing/application/subscription.service.js';

/**
 * Integridad de la suscripción de un comercio, contra PostgreSQL real.
 *
 * Los cuatro defectos que cubren estas pruebas no se ven leyendo una sola capa: dependen de
 * cómo el catálogo identifica un plan, de en qué estado nace una suscripción y de qué
 * ortografía se escribe en la columna. Todos degradaban en silencio.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
const createdTenants: string[] = [];

function baseCommand(overrides: Record<string, unknown> = {}) {
  const suffix = randomUUID();
  return {
    email: `owner-${suffix}@ejemplo.com`,
    password: 'Password123*',
    tenant_name: `Comercio ${suffix.slice(0, 8)}`,
    tenant_business_name: 'Comercio SAS',
    tenant_document_type: 'NIT',
    tenant_document_number: suffix.slice(0, 10).replaceAll('-', ''),
    name: 'Propietario',
    tax_mode: 'IVA',
    plan: 'STARTER',
    business_type: 'MINIMARKET',
    ...overrides
  } as never;
}

async function dropTenant(tenantId: string) {
  await adminDb().deleteFrom('platform_events').where('tenant_id', '=', tenantId).execute();
  await adminDb().deleteFrom('user_branches').where('tenant_id', '=', tenantId).execute();
  await adminDb()
    .deleteFrom('subscription_events')
    .where(
      'subscription_id',
      'in',
      adminDb().selectFrom('tenant_subscriptions').select('id').where('tenant_id', '=', tenantId)
    )
    .execute();
  await adminDb().deleteFrom('tenant_subscriptions').where('tenant_id', '=', tenantId).execute();
  await adminDb().deleteFrom('branches').where('tenant_id', '=', tenantId).execute();
  await adminDb().deleteFrom('users').where('tenant_id', '=', tenantId).execute();
  await adminDb().deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('Integridad de la suscripción', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const tenantId of createdTenants) {
      await dropTenant(tenantId);
    }
    for (const fixture of fixtures) {
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('el alta con el identificador del plan crea la suscripción', async () => {
    // El formulario del panel arranca en `'STARTER'` —el id— mientras el alta buscaba por
    // `billing_plans.name` («Plan Starter»). No encontraba nada, se saltaba la creación de
    // la suscripción y devolvía 201: comercios sin suscripción, sin un solo error.
    const useCase = new CreateTenantUseCase(adminDb());
    const tenantId = await useCase.execute(baseCommand({ plan: 'STARTER' }), randomUUID(), 'admin@plataforma.com');
    createdTenants.push(tenantId);

    const subscription = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'status'])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    expect(subscription).toBeDefined();
    expect(subscription?.plan_id).toBe('STARTER');
  });

  it('el alta con el nombre del plan sigue funcionando', async () => {
    const useCase = new CreateTenantUseCase(adminDb());
    const tenantId = await useCase.execute(baseCommand({ plan: 'Plan Starter' }), randomUUID(), 'admin@plataforma.com');
    createdTenants.push(tenantId);

    const subscription = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select(['plan_id'])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    expect(subscription?.plan_id).toBe('STARTER');
  });

  it('un plan inexistente rechaza el alta y no deja el comercio a medias', async () => {
    const useCase = new CreateTenantUseCase(adminDb());
    const command = baseCommand({ plan: 'PLAN_QUE_NO_EXISTE' });

    await expect(useCase.execute(command, randomUUID(), 'admin@plataforma.com')).rejects.toMatchObject({
      statusCode: 400,
      code: 'PLAN_NOT_FOUND'
    });

    const orphan = await adminDb()
      .selectFrom('tenants')
      .select('id')
      .where('nit', '=', (command as unknown as { tenant_document_number: string }).tenant_document_number)
      .executeTakeFirst();

    expect(orphan).toBeUndefined();
  });

  it('un comercio en prueba puede seguir creando usuarios', async () => {
    // El guard exigía `ACTIVE`. Durante los 14 días de prueba, crear un cajero respondía
    // «no se encontró una suscripción activa» — es decir, el trial no podía montar el
    // negocio en el periodo pensado para montarlo.
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    await adminDb()
      .updateTable('tenant_subscriptions')
      .set({ status: 'TRIAL', trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) })
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    // STARTER admite 3 usuarios y la fixture crea 2: queda sitio para uno más.
    await expect(QuotaGuard.assertCanCreateUser(adminDb(), fixture.tenantId)).resolves.toBeUndefined();
  });

  it('una suscripción suspendida no invita a mejorar de plan, dice que está suspendida', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    await adminDb()
      .updateTable('tenant_subscriptions')
      .set({ status: 'SUSPENDED', suspended_at: new Date() })
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    // El cliente web abre el modal de mejora de plan al ver `QUOTA_EXCEEDED`: ofrecerle
    // pagar más a quien tiene la suscripción suspendida no lo lleva a ninguna parte.
    await expect(QuotaGuard.assertCanCreateUser(adminDb(), fixture.tenantId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'SUBSCRIPTION_INACTIVE'
    });
  });

  it('agotar la cuota sí responde QUOTA_EXCEEDED', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    // STARTER admite 1 sucursal y la fixture ya creó la suya.
    await expect(QuotaGuard.assertCanCreateBranch(adminDb(), fixture.tenantId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'QUOTA_EXCEEDED'
    });
  });

  it('cancelar escribe CANCELLED, la ortografía que consultan las métricas', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    await SubscriptionService.cancelSubscription(adminDb(), fixture.tenantId);

    const subscription = await adminDb()
      .selectFrom('tenant_subscriptions')
      .select(['status', 'cancelled_at'])
      .where('tenant_id', '=', fixture.tenantId)
      .executeTakeFirst();

    expect(subscription?.status).toBe('CANCELLED');
    expect(subscription?.cancelled_at).not.toBeNull();
  });

  it('la base impide dos suscripciones vivas para el mismo comercio', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    // Sin el índice único de la migración 091, esta segunda fila entraba sin protestar y a
    // partir de ahí cuál se leía era arbitrario — incluido el plan que se firma en el JWT.
    const duplicate = adminDb()
      .insertInto('tenant_subscriptions')
      .values({
        id: randomUUID(),
        tenant_id: fixture.tenantId,
        plan_id: 'PRO',
        status: 'ACTIVE',
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        starts_at: new Date()
      })
      .execute();

    await expect(duplicate).rejects.toThrow();
  });

  it('un estado fuera del catálogo no se puede escribir', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const wrongSpelling = adminDb()
      .updateTable('tenant_subscriptions')
      .set({ status: 'CANCELED' })
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    await expect(wrongSpelling).rejects.toThrow();
  });
});
