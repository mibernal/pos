import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app/build-app.js';
import {
  expandDemand,
  runnerFromKysely
} from '../src/contexts/inventory/application/recipe-expansion.js';
import {
  adminDb,
  bearerHeaders,
  cleanupE2eFixture,
  ensureE2eSchema,
  loginE2eUser,
  readAsTenant,
  seedE2eFixture,
  type E2eFixture
} from './helpers/e2e-fixture.js';

/**
 * Recetas y escandallo.
 *
 * Lo que se prueba aquí es lo que hoy no ocurría: que vender un plato baje sus ingredientes.
 * El módulo de inventario —balances, kardex, traslados, valoración— estaba completo y no le
 * servía de nada a un restaurante, porque una venta descargaba «hamburguesa», un producto
 * que nadie compra ni almacena, mientras el pan y la carne se consumían sin que el sistema
 * se enterara.
 */

describe('Recetas y escandallo', () => {
  let app: FastifyInstance;
  const fixtures: E2eFixture[] = [];

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

  interface Escenario {
    fixture: E2eFixture;
    token: string;
    hamburguesa: string;
    pan: string;
    carne: string;
    tomate: string;
    salsa: string;
  }

  /**
   * Una hamburguesa de 15.000 con pan a 500 y carne a 30.000 el kilo. Números redondos a
   * propósito: el costo teórico se puede verificar a mano y la prueba falla con una cifra
   * que se entiende, no con un delta.
   */
  async function escenario(): Promise<Escenario> {
    const fixture = await seedE2eFixture(app, { productPriceCents: 15_000 });
    fixtures.push(fixture);

    const ids = {
      hamburguesa: fixture.productId,
      pan: randomUUID(),
      carne: randomUUID(),
      tomate: randomUUID(),
      salsa: randomUUID()
    };

    await adminDb()
      .insertInto('products')
      .values([
        {
          id: ids.pan,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Pan de hamburguesa',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 500,
          active: true
        },
        {
          id: ids.carne,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Carne molida (kg)',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 30_000,
          active: true
        },
        {
          id: ids.tomate,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Tomate (kg)',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 4_000,
          active: true
        },
        {
          // La salsa no se compra: se prepara. Su `cost_cents` es cero y tiene que salir de
          // su propia receta, que es justamente el caso que el escandallo anidado resuelve.
          id: ids.salsa,
          tenant_id: fixture.tenantId,
          branch_id: fixture.branchId,
          name: 'Salsa de la casa (porción)',
          category: 'Insumos',
          tax_category: 'IVA_19',
          price_cents: 0,
          cost_cents: 0,
          active: true
        }
      ])
      .execute();

    await adminDb()
      .updateTable('products')
      .set({ name: 'Hamburguesa clásica', cost_cents: 0 })
      .where('id', '=', ids.hamburguesa)
      .execute();

    const token = await loginE2eUser(app, {
      email: fixture.adminEmail,
      password: fixture.adminPassword
    });

    return { fixture, token, ...ids };
  }

  async function guardarReceta(
    e: Escenario,
    productId: string,
    body: Record<string, unknown>
  ) {
    return app.inject({
      method: 'PUT',
      url: `/api/v1/recipes/${productId}`,
      headers: bearerHeaders(e.token),
      payload: body
    });
  }

  it('calcula el costo teórico del plato con merma y da el margen sobre el precio', async () => {
    const e = await escenario();

    const respuesta = await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [
        { ingredient_product_id: e.pan, qty: 1 },
        // Un 10 % de merma: la carne pierde agua al cocinarse. Se compra más de lo que llega
        // al plato, y ese exceso es lo que hace que el escandallo cuadre contra el conteo.
        { ingredient_product_id: e.carne, qty: 0.15, waste_percent: 10 }
      ]
    });

    expect(respuesta.statusCode).toBe(200);
    const receta = respuesta.json();

    // 1 × 500  +  0,165 kg × 30.000 = 500 + 4.950
    expect(receta.theoretical_cost_cents).toBe(5_450);
    expect(receta.margin_percent).toBe(63.67);

    const carne = receta.components.find((c: { ingredient_product_id: string }) => c.ingredient_product_id === e.carne);
    expect(carne.qty_per_unit).toBe(0.165);
    expect(carne.cost_cents).toBe(4_950);
  });

  it('descuenta los ingredientes, no el plato', async () => {
    const e = await escenario();

    await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [
        { ingredient_product_id: e.pan, qty: 1 },
        { ingredient_product_id: e.carne, qty: 0.15, waste_percent: 10 }
      ]
    });

    const expansion = await readAsTenant(app, e.fixture.tenantId, (trx) =>
      expandDemand(runnerFromKysely(trx), e.fixture.tenantId, [
        { productId: e.hamburguesa, variantId: null, qty: 3 }
      ])
    );

    const porProducto = new Map(expansion.lines.map((l) => [l.productId, l]));

    // El plato no se descuenta a sí mismo: no se almacena, se prepara.
    expect(porProducto.has(e.hamburguesa)).toBe(false);
    expect(porProducto.get(e.pan)).toMatchObject({ qty: 3, viaRecipe: true });
    expect(porProducto.get(e.carne)).toMatchObject({ qty: 0.495, viaRecipe: true });
    expect(expansion.truncated).toEqual([]);
  });

  it('sigue las recetas anidadas: la salsa cuesta lo que cuestan sus ingredientes', async () => {
    const e = await escenario();

    // La salsa rinde 10 porciones y lleva 2 kg de tomate: 0,2 kg por porción, 800 el costo.
    await guardarReceta(e, e.salsa, {
      yield_qty: 10,
      components: [{ ingredient_product_id: e.tomate, qty: 2 }]
    });

    const respuesta = await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [
        { ingredient_product_id: e.pan, qty: 1 },
        { ingredient_product_id: e.carne, qty: 0.15, waste_percent: 10 },
        { ingredient_product_id: e.salsa, qty: 1 }
      ]
    });

    expect(respuesta.statusCode).toBe(200);
    // 500 + 4.950 + 800. Con `products.cost_cents` la salsa habría costado cero.
    expect(respuesta.json().theoretical_cost_cents).toBe(6_250);

    const expansion = await readAsTenant(app, e.fixture.tenantId, (trx) =>
      expandDemand(runnerFromKysely(trx), e.fixture.tenantId, [
        { productId: e.hamburguesa, variantId: null, qty: 3 }
      ])
    );

    const porProducto = new Map(expansion.lines.map((l) => [l.productId, l]));
    // La salsa tampoco se almacena: lo que baja es el tomate.
    expect(porProducto.has(e.salsa)).toBe(false);
    expect(porProducto.get(e.tomate)?.qty).toBe(0.6);
  });

  it('rechaza que un producto sea ingrediente de sí mismo', async () => {
    const e = await escenario();

    const respuesta = await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [{ ingredient_product_id: e.hamburguesa, qty: 1 }]
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().error?.code ?? respuesta.json().code).toBe('RECIPE_SELF_REFERENCE');
  });

  it('rechaza una receta que se muerde la cola', async () => {
    const e = await escenario();

    await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [{ ingredient_product_id: e.pan, qty: 1 }]
    });

    // El pan llevaría hamburguesa, que lleva pan. Sin esta guarda no hay un error visible:
    // hay una expansión que no termina, de noche y sin nadie mirando.
    const respuesta = await guardarReceta(e, e.pan, {
      yield_qty: 1,
      components: [{ ingredient_product_id: e.hamburguesa, qty: 1 }]
    });

    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json().error?.code ?? respuesta.json().code).toBe('RECIPE_CYCLE');
  });

  it('mide la desviación entre lo que la receta explica y lo que el conteo encuentra', async () => {
    const e = await escenario();

    await guardarReceta(e, e.hamburguesa, {
      yield_qty: 1,
      components: [{ ingredient_product_id: e.carne, qty: 0.15, waste_percent: 10 }]
    });

    const hoy = new Date();
    const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

    await adminDb()
      .insertInto('inventory_transactions')
      .values([
        {
          id: randomUUID(),
          tenant_id: e.fixture.tenantId,
          branch_id: e.fixture.branchId,
          product_id: e.carne,
          variant_id: null,
          operation: 'RECIPE',
          reference_id: null,
          qty_change: '-0.495',
          balance_after: '9.505',
          notes: 'Venta #1 (receta)',
          created_by_user_id: e.fixture.adminUserId
        },
        {
          id: randomUUID(),
          tenant_id: e.fixture.tenantId,
          branch_id: e.fixture.branchId,
          product_id: e.carne,
          variant_id: null,
          operation: 'ADJUSTMENT_OUT',
          reference_id: null,
          qty_change: '-0.050',
          balance_after: '9.455',
          notes: 'Conteo físico',
          created_by_user_id: e.fixture.adminUserId
        }
      ])
      .execute();

    const respuesta = await app.inject({
      method: 'GET',
      url: `/api/v1/recipes/reports/consumption-deviation?from=${fecha}&to=${fecha}&branch_id=${e.fixture.branchId}`,
      headers: bearerHeaders(e.token)
    });

    expect(respuesta.statusCode).toBe(200);
    const filas = respuesta.json();
    const carne = filas.find((f: { product_id: string }) => f.product_id === e.carne);

    expect(carne.theoretical_qty).toBe(0.495);
    expect(carne.adjusted_qty).toBe(-0.05);
    // Se está yendo un 10 % más de carne de lo que las recetas explican.
    expect(carne.deviation_percent).toBe(-10.1);
    expect(carne.deviation_cost_cents).toBe(-1_500);
  });
});
