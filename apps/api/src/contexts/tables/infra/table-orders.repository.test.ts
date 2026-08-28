import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app/build-app.js';
import {
  adminDb,
  closeAdminDb,
  cleanupE2eFixture,
  ensureE2eSchema,
  seedE2eFixture,
  type E2eFixture
} from '../../../../test/helpers/e2e-fixture.js';
import { TableOrdersRepository } from './table-orders.repository.js';

/**
 * Envío a cocina por deltas ("Fire to Kitchen").
 *
 * Antes se probaba contra un doble de Kysely que devolvía la misma respuesta para todas
 * las consultas, de modo que el cálculo del delta —lo único que importa aquí— quedaba
 * fuera de la prueba. Contra Postgres real sí se verifica que un segundo envío solo
 * manda lo que se agregó desde el primero.
 */

let app: FastifyInstance;
let repository: TableOrdersRepository;
const createdTenants: Array<Pick<E2eFixture, 'tenantId'>> = [];
const createdRooms: string[] = [];

async function seedOpenTableOrder(fixture: E2eFixture, qty: number) {
  const roomId = randomUUID();
  const tableId = randomUUID();
  const orderId = randomUUID();
  createdRooms.push(roomId);

  await adminDb().transaction().execute(async (trx) => {
    await trx
      .insertInto('rooms')
      .values({
        id: roomId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        name: 'Salón principal'
      })
      .execute();

    await trx
      .insertInto('tables')
      .values({
        id: tableId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        room_id: roomId,
        name: 'Mesa 1',
        status: 'OCCUPIED'
      })
      .execute();

    await trx
      .insertInto('table_orders')
      .values({
        id: orderId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_id: tableId,
        status: 'OPEN'
      })
      .execute();

    await trx
      .insertInto('table_order_items')
      .values({
        id: randomUUID(),
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_order_id: orderId,
        product_id: fixture.productId,
        variant_id: null,
        qty,
        price_cents: fixture.productPriceCents,
        line_total_cents: fixture.productPriceCents * qty,
        course: 1,
        notes: 'Sin cebolla'
      })
      .execute();
  });

  return { roomId, tableId, orderId };
}

async function setQty(fixture: E2eFixture, orderId: string, qty: number) {
  await adminDb()
    .updateTable('table_order_items')
    .set({ qty, line_total_cents: fixture.productPriceCents * qty })
    .where('tenant_id', '=', fixture.tenantId)
    .where('table_order_id', '=', orderId)
    .execute();
}

describe('TableOrdersRepository — envío a cocina por deltas', () => {
  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
    repository = new TableOrdersRepository(adminDb());
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenant = createdTenants.pop()!;
      await adminDb().deleteFrom('kitchen_ticket_items').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('kitchen_tickets').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('order_rounds').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('table_order_items').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('table_orders').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('tables').where('tenant_id', '=', tenant.tenantId).execute();
      await adminDb().deleteFrom('rooms').where('tenant_id', '=', tenant.tenantId).execute();
      await cleanupE2eFixture(app, tenant);
    }
    createdRooms.length = 0;
  });

  afterAll(async () => {
    await closeAdminDb();
    await app.close();
  });

  it('manda a cocina los ítems aún no impresos y los marca como enviados', async () => {
    const fixture = await seedE2eFixture(app);
    createdTenants.push({ tenantId: fixture.tenantId });
    const { tableId, orderId } = await seedOpenTableOrder(fixture, 2);

    const result = await repository.sendTableOrderToKitchen(
      fixture.tenantId,
      fixture.branchId,
      tableId
    );

    expect(result.order.id).toBe(orderId);
    expect(result.itemsSent).toHaveLength(1);
    expect(result.itemsSent[0]!.product_id).toBe(fixture.productId);
    expect(Number(result.itemsSent[0]!.qtyToSend)).toBe(2);
    expect(result.itemsSent[0]!.notes).toBe('Sin cebolla');

    const tickets = await adminDb()
      .selectFrom('kitchen_tickets')
      .select(['id', 'course', 'status'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('table_order_id', '=', orderId)
      .execute();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.course).toBe(1);
    expect(tickets[0]!.status).toBe('PENDING');

    const ticketItems = await adminDb()
      .selectFrom('kitchen_ticket_items')
      .select(['product_id', 'qty'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('table_order_id', '=', orderId)
      .execute();
    expect(ticketItems).toHaveLength(1);
    expect(Number(ticketItems[0]!.qty)).toBe(2);
  });

  it('en un segundo envío solo manda la diferencia, no lo ya impreso', async () => {
    const fixture = await seedE2eFixture(app);
    createdTenants.push({ tenantId: fixture.tenantId });
    const { tableId, orderId } = await seedOpenTableOrder(fixture, 2);

    await repository.sendTableOrderToKitchen(fixture.tenantId, fixture.branchId, tableId);

    // El mesero agrega una unidad más del mismo plato.
    await setQty(fixture, orderId, 3);

    const second = await repository.sendTableOrderToKitchen(
      fixture.tenantId,
      fixture.branchId,
      tableId
    );

    expect(second.itemsSent).toHaveLength(1);
    expect(Number(second.itemsSent[0]!.qtyToSend)).toBe(1);

    const rounds = await adminDb()
      .selectFrom('order_rounds')
      .select(['round_number'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('table_order_id', '=', orderId)
      .orderBy('round_number', 'asc')
      .execute();
    expect(rounds.map((r) => r.round_number)).toEqual([1, 2]);
  });

  it('no crea una nueva ronda si no hay nada nuevo que enviar', async () => {
    const fixture = await seedE2eFixture(app);
    createdTenants.push({ tenantId: fixture.tenantId });
    const { tableId, orderId } = await seedOpenTableOrder(fixture, 2);

    await repository.sendTableOrderToKitchen(fixture.tenantId, fixture.branchId, tableId);
    const second = await repository.sendTableOrderToKitchen(
      fixture.tenantId,
      fixture.branchId,
      tableId
    );

    expect(second.itemsSent).toHaveLength(0);

    const rounds = await adminDb()
      .selectFrom('order_rounds')
      .select(['id'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('table_order_id', '=', orderId)
      .execute();
    expect(rounds).toHaveLength(1);
  });
});
