import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Job } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '@pos-dian/api/src/app/build-app.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  grantLimits,
  grantModules,
  loginE2eUser,
  seedE2eFixture,
  type E2eFixture
} from '@pos-dian/api/test/helpers/e2e-fixture.js';
import { buildOutboxSaleCreatedProcessor } from '../src/jobs/outbox-sale-created.processor.js';
import type { OutboxSaleCreatedJobData } from '../src/jobs/types.js';

/**
 * Criterio de salida de la fase 10.
 *
 * «Un servicio completo en un restaurante piloto: el mesero entra con su PIN, toma pedido, la
 * cocina lo despacha, la mesa se cobra, el inventario baja por ingrediente y el cierre
 * liquida las propinas del turno.»
 *
 * Vive en el worker y no en el API porque es el único sitio desde el que se puede recorrer el
 * camino entero: la venta la crea el API, pero **el inventario lo descarga el worker**, de
 * forma asíncrona y por el evento de caja de salida. Una prueba que se quedara en el API
 * tendría que dar por buena esa mitad, que es justo la que esta fase cambió.
 */

// La emisión DIAN no es lo que se verifica aquí y necesitaría un proveedor configurado.
vi.mock('../src/providers/index.js', () => ({
  buildDianProvider: () => null
}));

describe('Servicio completo en un restaurante', () => {
  let app: FastifyInstance;
  let pool: Pool;
  const fixtures: E2eFixture[] = [];

  beforeAll(async () => {
    await ensureE2eSchema();
    app = await buildApp();
    await app.ready();
    /**
     * El worker se conecta con el rol dueño, igual que en producción (`pool.ts` prefiere
     * `ADMIN_DATABASE_URL`): tiene que leer la caja de salida de todos los comercios, y la
     * tabla tiene RLS. Con el rol restringido, el `claim` del evento no ve ninguna fila y el
     * job termina en silencio sin descargar nada.
     */
    pool = new Pool({ connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL, max: 4 });
  }, 60_000);

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await cleanupE2eFixture(app, fixture);
    }
    await pool.end();
    await app.close();
  });

  it('de que el mesero entra con su PIN a que el turno se cierra con su propina', async () => {
    const fixture = await seedE2eFixture(app, { productPriceCents: 30_000 });
    fixtures.push(fixture);
    await grantModules(fixture.tenantId, [
      'restaurant',
      'tables',
      'waiters',
      'waiter_shifts',
      'tips',
      'kitchen',
      'kitchen_display',
      'inventory'
    ]);
    await grantLimits(fixture.tenantId, { waiters: 5, tables: 10 });

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    // ── La despensa ────────────────────────────────────────────────────────
    const pan = randomUUID();
    const carne = randomUUID();

    await adminDb()
      .insertInto('products')
      .values([
        {
          id: pan,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Pan',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 500,
          active: true
        },
        {
          id: carne,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Carne (kg)',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 30_000,
          active: true
        }
      ])
      .execute();

    await adminDb()
      .insertInto('inventory_balances')
      .values([
        {
          id: randomUUID(),
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          product_id: pan,
          variant_id: null,
          on_hand_qty: '100'
        },
        {
          id: randomUUID(),
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          product_id: carne,
          variant_id: null,
          on_hand_qty: '10'
        }
      ])
      .execute();

    // La hamburguesa: un pan y 150 g de carne con un 10 % de merma.
    const receta = await app.inject({
      method: 'PUT',
      url: `/api/v1/recipes/${fixture.productId}`,
      headers: bearerHeaders(token),
      payload: {
        yield_qty: 1,
        components: [
          { ingredient_product_id: pan, qty: 1 },
          { ingredient_product_id: carne, qty: 0.15, waste_percent: 10 }
        ]
      }
    });
    expect(receta.statusCode).toBe(200);
    expect(receta.json().theoretical_cost_cents).toBe(5_450);

    // ── El salón ───────────────────────────────────────────────────────────
    const roomId = randomUUID();
    const tableId = randomUUID();

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
        name: 'Mesa 2',
        capacity: 4
      })
      .execute();

    const caja = await app.inject({
      method: 'POST',
      url: '/api/v1/cash-sessions/open',
      headers: bearerHeaders(token),
      payload: { branch_id: fixture.branchId, terminal_id: fixture.terminalId, opening_amount_cents: 0 }
    });
    expect(caja.statusCode).toBe(201);
    const cashSessionId = caja.json().cash_session.id as string;

    // ── 1. El mesero entra con su PIN ──────────────────────────────────────
    const mesero = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/waiters`,
      headers: bearerHeaders(token),
      payload: { name: 'Ana', pin: '3141' }
    });
    expect(mesero.statusCode).toBe(201);

    const turno = await app.inject({
      method: 'POST',
      url: '/api/v1/waiter-shifts/open',
      headers: bearerHeaders(token),
      payload: {
        branch_id: fixture.branchId,
        pin: '3141',
        cash_session_id: cashSessionId,
        table_ids: [tableId]
      }
    });
    expect(turno.statusCode).toBe(201);
    const shiftId = turno.json().id as string;
    const waiterId = turno.json().waiter_id as string;

    // La mesa queda a su nombre.
    const mesaAsignada = await adminDb()
      .selectFrom('tables')
      .select('waiter_id')
      .where('id', '=', tableId)
      .executeTakeFirstOrThrow();
    expect(mesaAsignada.waiter_id).toBe(waiterId);

    // ── 2. Toma el pedido ──────────────────────────────────────────────────
    const orderId = randomUUID();
    await adminDb()
      .insertInto('table_orders')
      .values({
        id: orderId,
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_id: tableId,
        status: 'OPEN',
        waiter_id: waiterId,
        guests_count: 2
      })
      .execute();

    await adminDb()
      .insertInto('table_order_items')
      .values({
        id: randomUUID(),
        tenant_id: fixture.tenantId,
        branch_id: fixture.branchId,
        table_order_id: orderId,
        product_id: fixture.productId,
        qty: 2,
        price_cents: 30_000,
        line_total_cents: 60_000,
        course: 1,
        item_status: 'PENDING'
      })
      .execute();

    // ── 3. La cocina lo despacha ───────────────────────────────────────────
    const enviado = await app.inject({
      method: 'POST',
      url: `/api/v1/branches/${fixture.branchId}/tables/${tableId}/orders/kitchen-print`,
      headers: bearerHeaders(token)
    });
    expect([200, 201]).toContain(enviado.statusCode);

    const comanda = await adminDb()
      .selectFrom('kitchen_tickets')
      .select(['id', 'ready_at'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('table_order_id', '=', orderId)
      .executeTakeFirstOrThrow();
    expect(comanda.ready_at).toBeNull();

    const listo = await app.inject({
      method: 'PUT',
      url: `/api/v1/branches/${fixture.branchId}/kds/tickets/${comanda.id}/status`,
      headers: bearerHeaders(token),
      payload: { status: 'READY' }
    });
    expect([200, 204]).toContain(listo.statusCode);

    const despachada = await adminDb()
      .selectFrom('kitchen_tickets')
      .select('ready_at')
      .where('id', '=', comanda.id)
      .executeTakeFirstOrThrow();
    // La marca que hace medible el tiempo de cocina.
    expect(despachada.ready_at).not.toBeNull();

    // ── 4. Se cobra la mesa, con propina y en dos medios ───────────────────
    const propina = 10_000;
    const total = 60_000 + propina;

    const venta = await app.inject({
      method: 'POST',
      url: '/api/v1/sales',
      headers: bearerHeaders(token),
      payload: {
        client_uuid: randomUUID(),
        branch_id: fixture.branchId,
        cash_session_id: cashSessionId,
        table_order_id: orderId,
        waiterId,
        items: [{ product_id: fixture.productId, qty: 2 }],
        discount_cents: 0,
        tip_cents: propina,
        payments: [
          { method: 'CASH', amount_cents: Math.floor(total / 2) },
          { method: 'CARD', amount_cents: total - Math.floor(total / 2), approval_code: '998877' }
        ]
      }
    });
    expect(venta.statusCode).toBe(201);
    const saleId = venta.json().sale.id as string;

    // ── 5. El inventario baja por ingrediente ──────────────────────────────
    const evento = await adminDb()
      .selectFrom('outbox_events')
      .select('id')
      .where('tenant_id', '=', fixture.tenantId)
      .where('aggregate_id', '=', saleId)
      .where('type', '=', 'sale.created')
      .executeTakeFirstOrThrow();

    const processor = buildOutboxSaleCreatedProcessor({ pool });

    /**
     * El mismo job descarga el inventario y luego emite la factura. Lo segundo necesita una
     * resolución DIAN vigente que este comercio de prueba no tiene, y aquí no se está
     * verificando la emisión —eso lo cubren sus propias pruebas—, sino que un servicio
     * completo baja los ingredientes.
     *
     * Tragarse el fallo no esconde nada: si la descarga no hubiera ocurrido, las
     * comprobaciones de saldo de abajo lo dirían igual.
     */
    await processor({
      data: { outboxEventId: evento.id },
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as Job<OutboxSaleCreatedJobData>).catch((error: unknown) => {
      const mensaje = error instanceof Error ? error.message : String(error);
      if (!mensaje.includes('resolución de facturación')) throw error;
    });

    const balances = await adminDb()
      .selectFrom('inventory_balances')
      .select(['product_id', 'on_hand_qty'])
      .where('tenant_id', '=', fixture.tenantId)
      .execute();

    const porProducto = new Map(balances.map((fila) => [fila.product_id, Number(fila.on_hand_qty)]));

    // Dos hamburguesas: dos panes y 0,33 kg de carne (0,15 × 1,10 × 2).
    expect(porProducto.get(pan)).toBe(98);
    expect(porProducto.get(carne)).toBeCloseTo(9.67, 3);

    // El plato no se descuenta a sí mismo: no se almacena, se prepara.
    expect(porProducto.has(fixture.productId)).toBe(false);

    const movimientos = await adminDb()
      .selectFrom('inventory_transactions')
      .select(['product_id', 'operation'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('reference_id', '=', saleId)
      .execute();

    expect(movimientos).toHaveLength(2);
    // `RECIPE` distingue en el kardex el pan que bajó por venderse pan del que bajó por
    // venderse hamburguesas.
    expect(movimientos.every((movimiento) => movimiento.operation === 'RECIPE')).toBe(true);

    // ── 6. El cierre liquida la propina del turno ──────────────────────────
    const corte = await app.inject({
      method: 'POST',
      url: `/api/v1/waiter-shifts/${shiftId}/close`,
      headers: bearerHeaders(token),
      payload: {}
    });

    expect(corte.statusCode).toBe(200);
    expect(corte.json().sales_count).toBe(1);
    expect(corte.json().sales_total_cents).toBe(total);
    expect(corte.json().tips_total_cents).toBe(propina);
    // La mitad está en el cajón y se le puede entregar hoy; la otra la cobró el negocio.
    expect(corte.json().tips_cash_cents).toBeGreaterThan(0);
    expect(corte.json().tips_electronic_cents).toBeGreaterThan(0);
    expect(corte.json().guests_served).toBe(2);

    const liquidacion = await app.inject({
      method: 'POST',
      url: `/api/v1/cash-sessions/${cashSessionId}/tips/settle`,
      headers: bearerHeaders(token),
      payload: { pay_cash_now: true }
    });
    expect([200, 201]).toContain(liquidacion.statusCode);

    // La propina en efectivo sale del cajón con su movimiento, o el arqueo no cuadraría.
    const movimientoCaja = await adminDb()
      .selectFrom('cash_movements')
      .select(['amount_cents', 'type'])
      .where('tenant_id', '=', fixture.tenantId)
      .where('cash_session_id', '=', cashSessionId)
      .execute();

    expect(movimientoCaja.length).toBeGreaterThan(0);
  }, 60_000);
});
