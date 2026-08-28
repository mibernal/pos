import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  adminDb,
  closeAdminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Rastro de auditoría de los cambios de perfil del comercio.
 *
 * Antes corría contra un doble de Kysely escrito a mano que no soportaba SQL crudo, así
 * que dejó de ejecutarse cuando las rutas pasaron a envolverse en `executeAsTenant`.
 * Un registro de auditoría fiscal solo vale si se verifica que quedó escrito en la tabla.
 */

let app: FastifyInstance;
const createdTenants: Array<Pick<E2eFixture, 'tenantId'>> = [];

async function setup() {
  const fixture = await seedE2eFixture(app, { taxMode: 'IVA' });
  createdTenants.push({ tenantId: fixture.tenantId });
  const token = await loginE2eUser(app, {
    email: fixture.adminEmail,
    password: fixture.adminPassword
  });
  return { fixture, token };
}

async function readAuditLogs(tenantId: string, action: string) {
  return await adminDb()
    .selectFrom('audit_logs')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('action', '=', action)
    .execute();
}

describe('auditoría del perfil del comercio', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      await cleanupE2eFixture(app, createdTenants.pop()!);
    }
  });

  afterAll(async () => {
    await closeAdminDb();
    await app.close();
  });

  it('registra un log de auditoría al cambiar el modo fiscal', async () => {
    const { fixture, token } = await setup();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tenants/${fixture.tenantId}/tax-profile`,
      headers: { ...bearerHeaders(token), 'content-type': 'application/json' },
      payload: { taxMode: 'INC_RESTAURANT' }
    });

    expect(response.statusCode).toBe(200);

    const tenant = await adminDb()
      .selectFrom('tenants')
      .select(['tax_mode'])
      .where('id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();
    expect(tenant.tax_mode).toBe('INC_RESTAURANT');

    const logs = await readAuditLogs(fixture.tenantId, 'TENANT_TAX_MODE_UPDATED');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tenant_id: fixture.tenantId,
      branch_id: null,
      user_id: fixture.adminUserId,
      entity_type: 'TENANT',
      entity_id: fixture.tenantId
    });
    expect(logs[0]!.legacy_payload).toMatchObject({
      previous_tax_mode: 'IVA',
      new_tax_mode: 'INC_RESTAURANT'
    });
  });

  it('actualiza el perfil comercial y deja el antes y el después en auditoría', async () => {
    const { fixture, token } = await setup();

    const previous = await adminDb()
      .selectFrom('tenants')
      .select(['business_name', 'address', 'phone', 'footer_message'])
      .where('id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/tenants/current',
      headers: { ...bearerHeaders(token), 'content-type': 'application/json' },
      payload: {
        businessName: 'Carnes Centro SAS',
        nit: '900123123-7',
        address: 'Cra 7 # 15-20',
        phone: '6011234567',
        footerMessage: 'Gracias por su compra'
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: fixture.tenantId,
      businessName: 'Carnes Centro SAS',
      nit: '900123123-7',
      address: 'Cra 7 # 15-20',
      phone: '6011234567',
      footerMessage: 'Gracias por su compra',
      taxMode: 'IVA'
    });

    const tenant = await adminDb()
      .selectFrom('tenants')
      .select(['business_name', 'nit', 'address', 'phone', 'footer_message'])
      .where('id', '=', fixture.tenantId)
      .executeTakeFirstOrThrow();
    expect(tenant).toMatchObject({
      business_name: 'Carnes Centro SAS',
      nit: '900123123-7',
      address: 'Cra 7 # 15-20',
      phone: '6011234567',
      footer_message: 'Gracias por su compra'
    });

    const logs = await readAuditLogs(fixture.tenantId, 'TENANT_BUSINESS_PROFILE_UPDATED');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tenant_id: fixture.tenantId,
      branch_id: null,
      user_id: fixture.adminUserId,
      entity_type: 'TENANT',
      entity_id: fixture.tenantId
    });
    expect(logs[0]!.legacy_payload).toMatchObject({
      previous: {
        business_name: previous.business_name,
        address: previous.address,
        phone: previous.phone,
        footer_message: previous.footer_message
      },
      current: {
        business_name: 'Carnes Centro SAS',
        address: 'Cra 7 # 15-20',
        phone: '6011234567',
        footer_message: 'Gracias por su compra'
      }
    });
  });
});
