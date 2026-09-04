import type { Job } from 'bullmq';
import type { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult
} from '@pos-dian/shared/types/dian-provider.js';
import { buildOutboxSaleCreatedProcessor } from '../src/jobs/outbox-sale-created.processor.js';
import type { OutboxSaleCreatedJobData } from '../src/jobs/types.js';
import { DianProviderMock } from '../src/providers/dian-provider-mock.js';

// Desde la migración 087 el processor construye el proveedor a partir de
// `tenant_dian_settings` en vez de recibirlo por parámetro. Estas pruebas siguen
// necesitando controlarlo, así que se intercepta la fábrica.
const providerRef = vi.hoisted(() => ({ current: null as DianProvider | null }));

vi.mock('../src/providers/index.js', () => ({
  buildDianProvider: () => providerRef.current
}));

function useProvider(provider: DianProvider): DianProvider {
  providerRef.current = provider;
  return provider;
}

interface QueryResultLike<T = unknown> {
  rows: T[];
}

function createJob(outboxEventId: string): Job<OutboxSaleCreatedJobData> {
  return {
    data: { outboxEventId },
    log: vi.fn().mockResolvedValue(undefined)
  } as unknown as Job<OutboxSaleCreatedJobData>;
}

function createPoolMock(
  implementation: (queryText: string, params?: unknown[]) => Promise<QueryResultLike>
): Pool {
  // Estas pruebas cubren la emisión DIAN. El procesador, antes de emitir, descarga
  // inventario y ejecuta efectos secundarios (cocina y auditoría) dentro de
  // `executeAsTenantClient`, que pide un cliente dedicado con `pool.connect()`.
  // El doble resuelve por su cuenta ese preámbulo —control de transacción, contexto
  // de tenant y guarda de idempotencia— y deja pasar a la implementación de cada
  // prueba solo las consultas que le interesan.
  const PREAMBLE = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i;

  const query = vi.fn(async (queryText: string, params?: unknown[]) => {
    if (PREAMBLE.test(queryText)) {
      return { rows: [] } as QueryResultLike;
    }
    if (queryText.includes('set_config')) {
      return { rows: [] } as QueryResultLike;
    }
    // Inventario ya descargado: el bloque de descargo sale de inmediato. La prueba que
    // ejercita el descargo completo devuelve [] desde su propia implementación.
    if (queryText.includes('FROM inventory_transactions')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ?? { rows: [{ id: 'inventory-tx-existente' }] }) as QueryResultLike;
    }
    // Efectos secundarios (cocina / auditoría): irrelevantes para la emisión, salvo para la
    // prueba que verifica cómo se escriben. Se le pasan primero: si el doble los respondiera
    // por su cuenta, esa prueba no vería nunca las consultas sobre las que afirma.
    if (queryText.includes('kitchen_tickets') || queryText.includes('audit_logs')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ?? { rows: [] }) as QueryResultLike;
    }
    // Sin recetas: el producto se descarga a sí mismo, que es el caso de estas pruebas.
    // La expansión por receta se prueba contra Postgres real en `recipes.e2e.test.ts`.
    if (queryText.includes('FROM product_recipes')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ?? { rows: [] }) as QueryResultLike;
    }
    if (queryText.includes('tenant_dian_settings')) {
      return { rows: [{ provider_name: 'MOCK', credentials: {}, test_mode: true }] } as QueryResultLike;
    }
    // Numeración fiscal (fase 4). El comportamiento propio de la asignación —consecutivo,
    // concurrencia, agotamiento, reintento— se prueba contra Postgres real en
    // `fiscal-numbering.test.ts`; aquí solo hace falta que el procesador obtenga un número
    // para poder seguir hasta la emisión, que es lo que estas pruebas cubren.
    if (queryText.includes('SELECT resolution_id, prefix, document_number')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ?? { rows: [{ resolution_id: null, prefix: null, document_number: null }] }) as QueryResultLike;
    }
    if (queryText.includes('UPDATE dian_resolutions')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ??
        {
          rows: [
            {
              id: '99999999-9999-4999-a999-999999999999',
              resolution_number: '18764000001234',
              resolution_date: '2026-01-01',
              prefix: 'SETP',
              range_from: '990000000',
              range_to: '990010000',
              current_number: '990000001',
              alert_threshold: 500,
              valid_from: '2026-01-01',
              valid_until: '2027-01-01',
              technical_key: null
            }
          ]
        }) as QueryResultLike;
    }
    if (queryText.includes('SET resolution_id')) {
      return { rows: [] } as QueryResultLike;
    }
    if (queryText.includes("'dian_resolution.alert'")) {
      return { rows: [] } as QueryResultLike;
    }
    // Guarda «la venta no se anuló antes de emitirse». Por defecto la venta está viva;
    // la prueba que cubre la anulación temprana la sobrescribe con su implementación.
    if (queryText.includes('SELECT status FROM sales')) {
      const fromTest = await implementation(queryText, params).catch(() => null);
      return (fromTest ?? { rows: [{ status: 'COMPLETED' }] }) as QueryResultLike;
    }
    return implementation(queryText, params);
  });

  const connect = vi.fn(async () => ({
    query,
    release: vi.fn()
  }));

  return { query, connect } as unknown as Pool;
}

const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

function parseStructuredLogs(spy: typeof consoleInfoSpy | typeof consoleErrorSpy) {
  return spy.mock.calls
    .map(([line]) => {
      if (typeof line !== 'string') {
        return null;
      }

      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);
}

afterEach(() => {
  consoleInfoSpy.mockClear();
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  consoleInfoSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

describe('outbox sale created processor', () => {
  it('no emite la factura si la venta se anuló antes de que saliera', async () => {
    // Regresión: anular una venta dentro de la ventana del worker dejaba que la
    // factura llegara igual a la DIAN, y como la anulación solo publicaba su evento
    // cuando ya existía un documento, tampoco se emitía nota crédito. El resultado
    // era una factura válida ante la DIAN por una venta que no ocurrió.
    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT status FROM sales')) {
        return { rows: [{ status: 'VOID' }] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };
    useProvider(provider);

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    await processor(createJob('44444444-4444-4444-a444-444444444444'));

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(parseStructuredLogs(consoleInfoSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_skipped',
          provider_result: 'SKIPPED',
          reason: 'SALE_VOIDED_BEFORE_EMISSION'
        })
      ])
    );
  });

  it('descarga los ingredientes de la receta y no el plato', async () => {
    // El caso que justifica toda la fase: en un restaurante, vender una hamburguesa tiene
    // que bajar pan y carne. Antes bajaba «hamburguesa» —un producto que nadie compra ni
    // almacena— y los ingredientes se consumían sin que el sistema se enterara.
    const PLATO = '66666666-6666-4666-a666-666666666666';
    const PAN = '88888888-8888-4888-a888-888888888888';
    const CARNE = '99999999-9999-4999-a999-999999999999';

    const executed: Array<{ text: string; params?: unknown[] }> = [];

    const pool = createPoolMock(async (queryText, params) => {
      executed.push({ text: queryText, params });

      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: {
                idempotency_key: '55555555-5555-4555-a555-555555555555',
                sale_id: '22222222-2222-4222-a222-222222222222',
                tenant_id: '11111111-1111-4111-a111-111111111111',
                branch_id: '33333333-3333-4333-a333-333333333333',
                sale_number: 7
              }
            }
          ]
        };
      }

      // Inventario todavía sin descargar: se ejerce el camino completo.
      if (queryText.includes('FROM inventory_transactions')) {
        return { rows: [] };
      }

      // Un pan y 150 g de carne con 10 % de merma por unidad de plato.
      if (queryText.includes('FROM product_recipes')) {
        return {
          rows: [
            {
              recipe_id: 'receta-1',
              product_id: PLATO,
              variant_id: null,
              yield_qty: '1.000',
              ingredient_product_id: PAN,
              ingredient_variant_id: null,
              qty: '1.0000',
              waste_percent: '0.00'
            },
            {
              recipe_id: 'receta-1',
              product_id: PLATO,
              variant_id: null,
              yield_qty: '1.000',
              ingredient_product_id: CARNE,
              ingredient_variant_id: null,
              qty: '0.1500',
              waste_percent: '10.00'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items') && !queryText.includes('INNER JOIN products p')) {
        return { rows: [{ id: 'sale-item-1', product_id: PLATO, variant_id: null, qty: 2 }] };
      }

      if (queryText.includes('INSERT INTO inventory_balances')) {
        return { rows: [{ on_hand_qty: 50 }] };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '7',
              created_at: new Date('2026-08-27T12:00:00.000Z'),
              subtotal_cents: 30000,
              discount_cents: 0,
              total_cents: 30000,
              tax_total_cents: 0,
              tax_lines_json: [],
              payment_json: { mode: 'CASH', total_cents: 30000, payments: [{ method: 'CASH', amount_cents: 30000 }] },
              void_reason: null,
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant 1',
              tenant_nit: '900000001',
              tenant_business_name: 'Tenant 1 SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Centro',
              branch_address: 'Calle 1'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'sale-item-1',
              product_id: PLATO,
              qty: '2.000',
              price_cents: 15000,
              line_total_cents: 30000,
              product_name: 'Hamburguesa clásica',
              barcode: null,
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('FROM sales')) {
        return { rows: [{ created_by_user_id: '77777777-7777-4777-a777-777777777777', status: 'COMPLETED' }] };
      }

      if (queryText.includes('FROM inventory_ledger')) return { rows: [] };
      if (queryText.includes('FROM products')) return { rows: [{ name: 'Insumo', min_stock_alert_qty: null }] };
      if (queryText.includes('INSERT INTO inventory_transactions')) return { rows: [] };
      if (queryText.includes('INSERT INTO inventory_ledger')) return { rows: [] };
      if (queryText.includes('INSERT INTO outbox_events')) return { rows: [] };

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return { rows: [{ id: 'doc-1', status: 'PENDING', cude: null }] };
      }

      if (queryText.includes('UPDATE dian_documents')) return { rows: [] };
      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    useProvider({
      emitSale: vi.fn(async () => ({ status: 'ACCEPTED' as const, cude: 'CUDE-RECETA', raw: {} }))
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    await processor(createJob('44444444-4444-4444-a444-444444444444'));

    const movimientos = executed
      .filter((q) => q.text.includes('INSERT INTO inventory_transactions'))
      .map((q) => ({ productId: q.params?.[2], qtyChange: q.params?.[5], operation: q.params?.[9] }));

    // El plato no se descuenta a sí mismo: no se almacena, se prepara.
    expect(movimientos.some((m) => m.productId === PLATO)).toBe(false);

    expect(movimientos).toEqual(
      expect.arrayContaining([
        { productId: PAN, qtyChange: -2, operation: 'RECIPE' },
        // 2 × 0,15 × 1,10 = 0,33
        { productId: CARNE, qtyChange: -0.33, operation: 'RECIPE' }
      ])
    );

    // El kardex distingue el pan que bajó por venderse pan del que bajó por hamburguesas.
    const kardex = executed.filter((q) => q.text.includes('INSERT INTO inventory_ledger'));
    expect(kardex).toHaveLength(2);
    for (const fila of kardex) {
      expect(fila.params?.[10]).toBe('RECIPE_DISCHARGE');
    }
  });

  it('publica la alerta de bajo stock sin poner en riesgo el descargo ni la emisión', async () => {
    // Regresión del fallo más caro encontrado en la fase 0: la alerta se insertaba en una
    // columna inexistente (`event_type`) y dentro de la misma transacción que descarga el
    // inventario. Cuando un producto cruzaba su mínimo, la transacción reventaba, el
    // inventario no se descargaba y la factura de esa venta nunca se emitía: el evento
    // quedaba reintentándose en bucle. La alerta ahora se publica después del commit y
    // en su propia transacción.
    const executed: Array<{ text: string; params?: unknown[] }> = [];

    const pool = createPoolMock(async (queryText, params) => {
      executed.push({ text: queryText, params });

      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: {
                idempotency_key: '55555555-5555-4555-a555-555555555555',
                sale_id: '22222222-2222-4222-a222-222222222222',
                tenant_id: '11111111-1111-4111-a111-111111111111',
                branch_id: '33333333-3333-4333-a333-333333333333',
                sale_number: 7
              }
            }
          ]
        };
      }

      // Inventario todavía sin descargar: se ejerce el camino completo.
      if (queryText.includes('FROM inventory_transactions')) {
        return { rows: [] };
      }

      if (queryText.includes('FROM sale_items')) {
        return {
          rows: [
            {
              id: 'sale-item-1',
              product_id: '66666666-6666-4666-a666-666666666666',
              variant_id: null,
              qty: 3
            }
          ]
        };
      }

      // Queda en 2 unidades, por debajo del mínimo de 5.
      if (queryText.includes('INSERT INTO inventory_balances')) {
        return { rows: [{ on_hand_qty: 2 }] };
      }

      // Cabecera para el payload del proveedor DIAN.
      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '7',
              created_at: new Date('2026-08-27T12:00:00.000Z'),
              subtotal_cents: 4500,
              discount_cents: 0,
              total_cents: 4500,
              tax_total_cents: 718,
              tax_lines_json: [],
              payment_json: { mode: 'CASH', total_cents: 4500, payments: [{ method: 'CASH', amount_cents: 4500 }] },
              void_reason: null,
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant 1',
              tenant_nit: '900000001',
              tenant_business_name: 'Tenant 1 SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Centro',
              branch_address: 'Calle 1'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'sale-item-1',
              product_id: '66666666-6666-4666-a666-666666666666',
              qty: '3.000',
              price_cents: 1500,
              line_total_cents: 4500,
              product_name: 'Café Americano',
              barcode: null,
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('FROM sales')) {
        return { rows: [{ created_by_user_id: '77777777-7777-4777-a777-777777777777', status: 'COMPLETED' }] };
      }

      if (queryText.includes('FROM inventory_ledger')) {
        return { rows: [] };
      }

      if (queryText.includes('FROM products')) {
        return { rows: [{ name: 'Café Americano', min_stock_alert_qty: 5 }] };
      }

      if (queryText.includes('INSERT INTO inventory_transactions')) return { rows: [] };
      if (queryText.includes('INSERT INTO inventory_ledger')) return { rows: [] };
      if (queryText.includes('INSERT INTO outbox_events')) return { rows: [] };

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return { rows: [{ id: 'doc-1', status: 'PENDING', cude: null }] };
      }

      if (queryText.includes('UPDATE dian_documents')) return { rows: [] };
      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-ALERTA',
        raw: {}
      }))
    };
    useProvider(provider);

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    await processor(createJob('44444444-4444-4444-a444-444444444444'));

    // La factura se emite: la alerta no interfiere.
    expect(provider.emitSale).toHaveBeenCalledOnce();

    const alertInsert = executed.find(
      (q) => q.text.includes('INSERT INTO outbox_events') && q.text.includes('low_stock.alert')
    );

    expect(alertInsert, 'debe publicarse la alerta de bajo stock').toBeDefined();
    // La columna es `type`; `event_type` no existe en ninguna migración.
    expect(alertInsert!.text).not.toContain('event_type');

    const alertPayload = JSON.parse(String(alertInsert!.params?.[3]));
    expect(alertPayload).toMatchObject({
      product_id: '66666666-6666-4666-a666-666666666666',
      // `product_name` es obligatorio en el esquema del procesador de alertas.
      product_name: 'Café Americano',
      tenant_id: '11111111-1111-4111-a111-111111111111',
      branch_id: '33333333-3333-4333-a333-333333333333',
      current_qty: 2,
      min_stock_alert_qty: 5
    });
  });

  it('does not re-emit when dian document is ACCEPTED even without CUDE', async () => {
    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 2,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-1',
              status: 'ACCEPTED',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };
    useProvider(provider);

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    const job = createJob('44444444-4444-4444-a444-444444444444');

    await processor(job);

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('reason=document already accepted');
    expect(parseStructuredLogs(consoleInfoSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_skipped',
          outbox_event_id: '44444444-4444-4444-a444-444444444444',
          sale_id: '22222222-2222-4222-a222-222222222222',
          tenant_id: '11111111-1111-4111-a111-111111111111',
          attempt: 3,
          provider_result: 'SKIPPED',
          reason: 'document already accepted'
        })
      ])
    );
  });

  it('builds provider payload from persisted fiscal data and product tax category', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-123',
        raw: { provider: 'mock' }
      }))
    };
    useProvider(provider);

    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-2',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '27',
              created_at: new Date('2026-03-05T12:00:00.000Z'),
              subtotal_cents: 10800,
              discount_cents: 0,
              total_cents: 10800,
              tax_total_cents: 800,
              tax_lines_json: [
                {
                  line_index: 0,
                  category: 'INC',
                  base_cents: 10000,
                  tax_cents: 800,
                  rate: 0.08
                }
              ],
              payment_json: {
                mode: 'CASH',
                total_cents: 10800,
                payments: [{ method: 'CASH', amount_cents: 10800 }]
              },
              tax_mode: 'INC_RESTAURANT',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant 2',
              tenant_nit: '900000002',
              tenant_business_name: 'Tenant 2 SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Norte',
              branch_address: 'Cra 7 # 12-34'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-1',
              product_id: 'product-1',
              qty: '1.000',
              price_cents: 10800,
              line_total_cents: 10800,
              product_name: 'Almuerzo',
              barcode: null,
              tax_category: 'INC_8'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    await processor(createJob('44444444-4444-4444-a444-444444444444'));

    expect(provider.emitSale).toHaveBeenCalledOnce();

    const payload = (provider.emitSale as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | DianProviderEmitSaleInput
      | undefined;

    expect(payload).toBeDefined();
    expect(payload?.taxMode).toBe('INC_RESTAURANT');
    expect(payload?.sale.tax_total_cents).toBe(800);
    expect(payload?.sale.tax_lines).toEqual([
      {
        lineIndex: 0,
        category: 'INC',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08
      }
    ]);
    expect(payload?.sale.items).toEqual([
      {
        id: 'item-1',
        product_id: 'product-1',
        product_name: 'Almuerzo',
        barcode: null,
        tax_category: 'INC_8',
        category: 'INC',
        base_cents: 10000,
        tax_cents: 800,
        rate: 0.08,
        qty: 1,
        price_cents: 10800,
        line_total_cents: 10800
      }
    ]);
  });

  it('processes a pending dian document through ACCEPTED and marks the outbox as sent', async () => {
    const provider = useProvider(new DianProviderMock());
    const dianDocumentUpdates: unknown[][] = [];
    const outboxSentUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-accepted',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '101',
              created_at: new Date('2026-03-07T10:00:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 11900,
              tax_total_cents: 1900,
              tax_lines_json: [
                {
                  line_index: 0,
                  category: 'IVA_19',
                  base_cents: 10000,
                  tax_cents: 1900,
                  rate: 0.19
                }
              ],
              payment_json: {
                mode: 'CARD',
                total_cents: 11900,
                payments: [{ method: 'CARD', amount_cents: 11900 }]
              },
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant Accepted',
              tenant_nit: '900000101',
              tenant_business_name: 'Tenant Accepted SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Centro',
              branch_address: 'Cra 10 # 20-30'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-accepted',
              product_id: 'product-accepted',
              qty: '1.000',
              price_cents: 11900,
              line_total_cents: 11900,
              product_name: 'Combo Ejecutivo',
              barcode: '7701001001001',
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        dianDocumentUpdates.push(params);
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        outboxSentUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    const job = createJob('44444444-4444-4444-a444-444444444444');

    await processor(job);

    expect(dianDocumentUpdates).toHaveLength(1);
    expect(outboxSentUpdates).toHaveLength(1);

    const [dianDocumentId, providerPayloadJson, providerResponseJson, finalStatus, cude] =
      dianDocumentUpdates[0]!;

    expect(dianDocumentId).toBe('doc-accepted');
    expect(finalStatus).toBe('ACCEPTED');
    expect(cude).toMatch(/^CUDE-/);
    expect(JSON.parse(providerPayloadJson as string)).toMatchObject({
      sale_id: '22222222-2222-4222-a222-222222222222',
      taxMode: 'IVA',
      sale: {
        tax_total_cents: 1900,
        tax_lines: [
          {
            lineIndex: 0,
            category: 'IVA_19',
            base_cents: 10000,
            tax_cents: 1900,
            rate: 0.19
          }
        ]
      }
    });
    expect(JSON.parse(providerResponseJson as string)).toMatchObject({
      provider: 'mock',
      taxMode: 'IVA',
      tax_total_cents: 1900
    });

    expect(outboxSentUpdates[0]).toEqual(['44444444-4444-4444-a444-444444444444', 1]);
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'transitions=PENDING->SENT, SENT->ACCEPTED'
    );
    expect(parseStructuredLogs(consoleInfoSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_started',
          outbox_event_id: '44444444-4444-4444-a444-444444444444',
          sale_id: '22222222-2222-4222-a222-222222222222',
          tenant_id: '11111111-1111-4111-a111-111111111111',
          attempt: 1
        }),
        expect.objectContaining({
          event: 'dian_outbox_job_succeeded',
          outbox_event_id: '44444444-4444-4444-a444-444444444444',
          sale_id: '22222222-2222-4222-a222-222222222222',
          tenant_id: '11111111-1111-4111-a111-111111111111',
          attempt: 1,
          dian_transition: 'PENDING->SENT, SENT->ACCEPTED',
          provider_result: 'ACCEPTED'
        })
      ])
    );
  });

  it('does not re-emit when dian document is already SENT', async () => {
    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'FAILED',
              attempts: 1,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-3',
              status: 'SENT',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const provider: DianProvider = {
      emitSale: vi.fn<
        (input: DianProviderEmitSaleInput) => Promise<DianProviderEmitSaleResult>
      >()
    };
    useProvider(provider);

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    const job = createJob('44444444-4444-4444-a444-444444444444');

    await processor(job);

    expect(provider.emitSale).not.toHaveBeenCalled();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain('reason=document already emitted');
  });

  it('marks the outbox as processed when provider rejects the document', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'REJECTED' as const,
        cude: null,
        raw: { provider: 'mock', reason: 'invalid xml' }
      }))
    };
    useProvider(provider);

    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-4',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '33',
              created_at: new Date('2026-03-07T12:00:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 10000,
              tax_total_cents: 1597,
              tax_lines_json: [],
              payment_json: {
                mode: 'CASH',
                total_cents: 10000,
                payments: [{ method: 'CASH', amount_cents: 10000 }]
              },
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant 4',
              tenant_nit: '900000004',
              tenant_business_name: 'Tenant 4 SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Sur',
              branch_address: 'Calle 8 # 10-20'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-4',
              product_id: 'product-4',
              qty: '1.000',
              price_cents: 10000,
              line_total_cents: 10000,
              product_name: 'Producto Demo',
              barcode: null,
              tax_category: 'IVA_19'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        return { rows: [] };
      }

      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      if (queryText.includes("SET status = 'FAILED'")) {
        throw new Error(`No se esperaba reintento para rechazo terminal: ${queryText}`);
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    const job = createJob('44444444-4444-4444-a444-444444444444');

    await processor(job);

    expect(provider.emitSale).toHaveBeenCalledOnce();
    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'transitions=PENDING->REJECTED'
    );
  });

  it('marks the outbox as failed with retry metadata when provider emit fails', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => {
        throw new Error('network timeout');
      })
    };
    useProvider(provider);

    const dianDocumentUpdates: unknown[][] = [];
    const outboxFailedUpdates: unknown[][] = [];

    const pool = createPoolMock(async (queryText, params = []) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: { idempotency_key: '55555555-5555-4555-a555-555555555555', sale_id: '22222222-2222-4222-a222-222222222222', tenant_id: '11111111-1111-4111-a111-111111111111', branch_id: '33333333-3333-4333-a333-333333333333' }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return {
          rows: [
            {
              id: 'doc-failed',
              status: 'PENDING',
              cude: null
            }
          ]
        };
      }

      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '202',
              created_at: new Date('2026-03-07T12:30:00.000Z'),
              subtotal_cents: 9000,
              discount_cents: 0,
              total_cents: 9000,
              tax_total_cents: 0,
              tax_lines_json: [],
              payment_json: {
                mode: 'CASH',
                total_cents: 9000,
                payments: [{ method: 'CASH', amount_cents: 9000 }]
              },
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant Failed',
              tenant_nit: '900000202',
              tenant_business_name: 'Tenant Failed SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Occidente',
              branch_address: 'Calle 20 # 30-40'
            }
          ]
        };
      }

      if (queryText.includes('FROM sale_items si') && queryText.includes('INNER JOIN products p')) {
        return {
          rows: [
            {
              id: 'item-failed',
              product_id: 'product-failed',
              qty: '1.000',
              price_cents: 9000,
              line_total_cents: 9000,
              product_name: 'Producto Fallido',
              barcode: null,
              tax_category: 'EXCLUDED'
            }
          ]
        };
      }

      if (queryText.includes('UPDATE dian_documents') && queryText.includes('provider_payload_json')) {
        dianDocumentUpdates.push(params);
        return { rows: [] };
      }

      if (queryText.includes("UPDATE outbox_events") && queryText.includes("SET status = 'FAILED'")) {
        outboxFailedUpdates.push(params);
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    const job = createJob('44444444-4444-4444-a444-444444444444');

    await expect(processor(job)).rejects.toThrow('network timeout');

    expect(provider.emitSale).toHaveBeenCalledOnce();
    expect(dianDocumentUpdates).toHaveLength(1);
    expect(outboxFailedUpdates).toHaveLength(1);

    const [dianDocumentId, providerPayloadJson, providerResponseJson, status, cude] =
      dianDocumentUpdates[0]!;
    expect(dianDocumentId).toBe('doc-failed');
    expect(status).toBeUndefined();
    expect(cude).toBeUndefined();
    expect(JSON.parse(providerPayloadJson as string)).toMatchObject({
      sale_id: '22222222-2222-4222-a222-222222222222',
      taxMode: 'IVA'
    });
    expect(JSON.parse(providerResponseJson as string)).toEqual({
      provider: 'mock',
      error: 'network timeout'
    });

    const [outboxId, attempts, nextRetryAt] = outboxFailedUpdates[0]!;
    expect(outboxId).toBe('44444444-4444-4444-a444-444444444444');
    expect(attempts).toBe(1);
    expect(nextRetryAt).toBeInstanceOf(Date);
    expect((nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now());

    expect(job.log).toHaveBeenCalledOnce();
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'next_retry_at='
    );
    expect((job.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      'error=network timeout'
    );
    expect(parseStructuredLogs(consoleErrorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'dian_outbox_job_failed',
          outbox_event_id: '44444444-4444-4444-a444-444444444444',
          sale_id: '22222222-2222-4222-a222-222222222222',
          tenant_id: '11111111-1111-4111-a111-111111111111',
          attempt: 1,
          provider_result: 'ERROR',
          dian_transition: 'PENDING->PENDING'
        })
      ])
    );
  });

  it('ejecuta side effects de auditoría con entity_id como string sin fallar con operator does not exist: text = uuid', async () => {
    const executedQueries: { text: string; params?: unknown[] }[] = [];

    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-TEST-AUDIT',
        raw: {}
      }))
    };
    useProvider(provider);

    const pool = createPoolMock(async (queryText, params) => {
      executedQueries.push({ text: queryText, params });

      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: {
                idempotency_key: '55555555-5555-4555-a555-555555555555',
                sale_id: '22222222-2222-4222-a222-222222222222',
                tenant_id: '11111111-1111-4111-a111-111111111111',
                branch_id: '33333333-3333-4333-a333-333333333333',
                audit_payload: {
                  client_uuid: '55555555-5555-4555-a555-555555555555',
                  items_count: 1,
                  subtotal_cents: 4500,
                  discount_cents: 0,
                  tax_total_cents: 718,
                  payment_mode: 'CASH',
                  snapshot_discrepancy: false
                }
              }
            }
          ]
        };
      }

      if (queryText.includes('SELECT id FROM audit_logs')) {
        return { rows: [] };
      }
      if (queryText.includes('SELECT created_by_user_id FROM sales')) {
        return { rows: [{ created_by_user_id: 'user-audit-123' }] };
      }
      if (queryText.includes('INSERT INTO audit_logs')) {
        return { rows: [] };
      }
      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return { rows: [{ id: 'doc-audit', status: 'PENDING', cude: null }] };
      }
      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '301',
              created_at: new Date('2026-03-07T12:30:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 10000,
              tax_total_cents: 0,
              tax_lines_json: [],
              payment_json: { mode: 'CASH', total_cents: 10000, payments: [{ method: 'CASH', amount_cents: 10000 }] },
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant Audit',
              tenant_nit: '900000301',
              tenant_business_name: 'Tenant Audit SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Audit',
              branch_address: 'Calle 10 # 20-30'
            }
          ]
        };
      }
      if (queryText.includes('FROM sale_items si')) {
        return { rows: [] };
      }
      if (queryText.includes('UPDATE dian_documents')) return { rows: [] };
      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    await processor(createJob('44444444-4444-4444-a444-444444444444'));

    expect(provider.emitSale).toHaveBeenCalledOnce();

    const auditSelect = executedQueries.find((q) => q.text.includes('SELECT id FROM audit_logs'));
    expect(auditSelect).toBeDefined();
    // La columna entity_id en audit_logs es TEXT; no debe llevar cast ::uuid en la comparación
    expect(auditSelect!.text).not.toContain('entity_id = $1::uuid');
    expect(auditSelect!.text).not.toContain('entity_id = $2::uuid');

    const auditInsert = executedQueries.find((q) => q.text.includes('INSERT INTO audit_logs'));
    expect(auditInsert).toBeDefined();
    // entity_id se inserta como parámetro sin ::uuid
    expect(auditInsert!.text).not.toContain('$4::uuid');
  });

  it('no aborta la emisión DIAN si los efectos secundarios (cocina/auditoría) lanzan un error', async () => {
    const provider: DianProvider = {
      emitSale: vi.fn(async () => ({
        status: 'ACCEPTED' as const,
        cude: 'CUDE-SIDE-EFFECTS-TEST',
        raw: {}
      }))
    };
    useProvider(provider);

    const pool = createPoolMock(async (queryText) => {
      if (queryText.includes('UPDATE outbox_events') && queryText.includes('SET next_retry_at')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-a444-444444444444',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              aggregate_id: '22222222-2222-4222-a222-222222222222',
              status: 'PENDING',
              attempts: 0,
              payload_json: {
                idempotency_key: '55555555-5555-4555-a555-555555555555',
                sale_id: '22222222-2222-4222-a222-222222222222',
                tenant_id: '11111111-1111-4111-a111-111111111111',
                branch_id: '33333333-3333-4333-a333-333333333333',
                audit_payload: {
                  client_uuid: '55555555-5555-4555-a555-555555555555',
                  items_count: 1,
                  subtotal_cents: 4500,
                  discount_cents: 0,
                  tax_total_cents: 718,
                  payment_mode: 'CASH',
                  error_trigger: true
                }
              }
            }
          ]
        };
      }

      // Simulamos un fallo inesperado en audit_logs
      if (queryText.includes('SELECT id FROM audit_logs')) {
        throw new Error('error simulado en audit_logs');
      }

      if (queryText.includes('SELECT id, status, cude') && queryText.includes('FROM dian_documents')) {
        return { rows: [{ id: 'doc-side-effects', status: 'PENDING', cude: null }] };
      }
      if (queryText.includes('FROM sales s') && queryText.includes('INNER JOIN tenants t')) {
        return {
          rows: [
            {
              sale_id: '22222222-2222-4222-a222-222222222222',
              sale_number: '302',
              created_at: new Date('2026-03-07T12:30:00.000Z'),
              subtotal_cents: 10000,
              discount_cents: 0,
              total_cents: 10000,
              tax_total_cents: 0,
              tax_lines_json: [],
              payment_json: { mode: 'CASH', total_cents: 10000, payments: [{ method: 'CASH', amount_cents: 10000 }] },
              tax_mode: 'IVA',
              tenant_id: '11111111-1111-4111-a111-111111111111',
              tenant_name: 'Tenant Side Effects',
              tenant_nit: '900000302',
              tenant_business_name: 'Tenant Side Effects SAS',
              branch_id: '33333333-3333-4333-a333-333333333333',
              branch_name: 'Sucursal Side Effects',
              branch_address: 'Calle 10 # 20-30'
            }
          ]
        };
      }
      if (queryText.includes('FROM sale_items si')) {
        return { rows: [] };
      }
      if (queryText.includes('UPDATE dian_documents')) return { rows: [] };
      if (queryText.includes('UPDATE outbox_events') && queryText.includes("SET status = 'SENT'")) {
        return { rows: [] };
      }

      throw new Error(`Query no esperada: ${queryText}`);
    });

    const processor = buildOutboxSaleCreatedProcessor({ pool });
    // No debe rechazar la promesa / lanzar excepción
    await expect(processor(createJob('44444444-4444-4444-a444-444444444444'))).resolves.not.toThrow();

    // La emisión DIAN se ejecutó exitosamente a pesar del fallo en side effects
    expect(provider.emitSale).toHaveBeenCalledOnce();

    // El error de side effects quedó registrado
    expect(parseStructuredLogs(consoleErrorSpy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'sale_side_effects_failed',
          message: 'Failed to execute side effects (kitchen/audit)'
        })
      ])
    );
  });
});
