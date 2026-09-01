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

/**
 * Flujo de meseros de punta a punta, en un comercio con el módulo activado.
 *
 * Reportado por el negocio: al abrir una mesa no aparece ningún mesero para asignar, y la
 * pantalla de usuarios no ofrece el rol de mesero. Estas pruebas recorren el camino
 * completo —crear el mesero, listarlo, asignarlo a la mesa y crear un usuario con rol
 * WAITER— contra Postgres real, que es donde el defecto se manifiesta.
 */

let app: FastifyInstance;
const fixtures: E2eFixture[] = [];
const createdRooms: string[] = [];

async function enableRestaurantModules(tenantId: string) {
  // Desde la fase 7 los módulos salen del plan; encender la columna de `tenants` ya no
  // habilita nada. Se conceden como excepción, igual que hace el panel de plataforma.
  await grantModules(tenantId, ['restaurant', 'tables', 'waiters']);
}

async function seedRoomAndTable(fixture: E2eFixture) {
  const roomId = randomUUID();
  const tableId = randomUUID();
  createdRooms.push(roomId);

  await adminDb()
    .insertInto('rooms')
    .values({ id: roomId, tenant_id: fixture.tenantId, branch_id: fixture.branchId, name: 'Salón' })
    .execute();

  await adminDb()
    .insertInto('tables')
    .values({
      id: tableId,
      tenant_id: fixture.tenantId,
      branch_id: fixture.branchId,
      room_id: roomId,
      name: 'Mesa 1',
      status: 'AVAILABLE'
    })
    .execute();

  return { roomId, tableId };
}

describe('Flujo de meseros con el módulo activo', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    for (const fixture of fixtures) {
      await adminDb().deleteFrom('waiters').where('tenant_id', '=', fixture.tenantId).execute();
      await adminDb().deleteFrom('tables').where('tenant_id', '=', fixture.tenantId).execute();
      await adminDb().deleteFrom('rooms').where('tenant_id', '=', fixture.tenantId).execute();
      await cleanupE2eFixture(app, fixture);
    }
    await app.close();
  });

  it('un admin puede crear un mesero, verlo en la lista y asignarlo a una mesa', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableRestaurantModules(fixture.tenantId);
    const { tableId } = await seedRoomAndTable(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token),
      payload: { name: 'Ana Mesera', pin: '1234' }
    });
    expect(created.statusCode, created.body).toBe(201);
    const waiter = created.json() as { id: string; name: string; is_active: boolean };
    expect(waiter.name).toBe('Ana Mesera');
    expect(waiter.is_active).toBe(true);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token)
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const waiters = listed.json() as Array<{ id: string }>;
    expect(waiters.map((w) => w.id)).toContain(waiter.id);

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/api/v1/branches/${fixture.branchId}/tables/${tableId}/waiter`,
      headers: bearerHeaders(token),
      payload: { waiterId: waiter.id }
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
  });

  it('un admin puede crear un usuario con rol WAITER', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableRestaurantModules(fixture.tenantId);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearerHeaders(token),
      payload: {
        email: `mesero.${randomUUID()}@e2e.posdian.local`,
        password: 'Mesero123*',
        name: 'Carlos Mesero',
        role: 'WAITER'
      }
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({ role: 'WAITER' });
  });

  it('un cuerpo inválido responde 400 diciendo qué campo falla, no 500', async () => {
    // El error de validación que produce Fastify a partir del esquema Zod de la ruta no es
    // un `ZodError`, así que caía hasta el 500 genérico: toda petición mal formada del
    // cliente respondía "Ocurrió un error interno" con `details: null`. Así se manifestó el
    // intento de crear un mesero, y así se habría manifestado cualquier otro error de forma.
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearerHeaders(token),
      payload: { email: 'no-es-un-correo', password: 'corta', name: '', role: 'ROL_QUE_NO_EXISTE' }
    });

    expect(response.statusCode, response.body).toBe(400);
    const body = response.json() as { error: { code: string; details: { issues: Array<{ path: string }> } } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues.length).toBeGreaterThan(0);
    expect(body.error.details.issues.map((i) => i.path)).toContain('role');
  });

  it('un usuario WAITER puede iniciar sesión y recibe permisos de atención en mesa', async () => {
    const fixture = await seedE2eFixture(app);
    fixtures.push(fixture);
    await enableRestaurantModules(fixture.tenantId);

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    const email = `mesero.${randomUUID()}@e2e.posdian.local`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/users',
      headers: bearerHeaders(token),
      payload: { email, password: 'Mesero123*', name: 'Luisa Mesera', role: 'WAITER', branch_ids: [fixture.branchId] }
    });
    expect(created.statusCode, created.body).toBe(201);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Mesero123*' }
    });
    expect(login.statusCode, login.body).toBe(200);

    const body = login.json() as { user: { role: string; permissions: string[] } };
    expect(body.user.role).toBe('WAITER');
    // Un mesero sin permisos es una cuenta que no sirve para nada: la pantalla de Mesas
    // del frontend se habilita con `sales:create`, así que sin él no vería nada.
    expect(body.user.permissions).toContain('sales:create');
    expect(body.user.permissions).toContain('products:view');
    // Y no debe recibir de más.
    expect(body.user.permissions).not.toContain('users:manage');
    expect(body.user.permissions).not.toContain('sales:void');
    expect(body.user.permissions).not.toContain('cash:close');
  });
});
