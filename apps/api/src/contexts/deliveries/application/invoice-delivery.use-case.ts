import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../../shared/infra/db/schema.js';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { createSaleService } from '../../sales/services/create-sale.service.js';
import type { SalePaymentInput } from '../../sales/services/schemas.js';

/**
 * Facturar un domicilio entregado.
 *
 * El módulo de domicilios llevaba su propio ciclo de vida (PENDIENTE → PREPARACIÓN → EN
 * CAMINO → ENTREGADO) y ahí se acababa: nada creaba la venta, así que **un domicilio
 * entregado no generaba ningún documento fiscal**. El pedido se cobraba y no se facturaba.
 *
 * Dos decisiones de diseño:
 *
 * 1. **No se factura automáticamente al marcar ENTREGADO.** Una venta necesita un turno de
 *    caja abierto y un medio de pago, y ninguno de los dos se puede adivinar: el repartidor
 *    pudo cobrar en efectivo, con datáfono, o el cliente pudo pagar por adelantado. Se
 *    factura con una llamada explícita que aporta esos datos. Marcar ENTREGADO sin
 *    facturar sigue siendo posible —hay negocios que facturan al cierre del día— pero el
 *    domicilio queda visiblemente pendiente de documento.
 *
 * 2. **La idempotencia se deriva del domicilio.** El `client_uuid` de la venta es un UUID
 *    determinista calculado a partir del id del domicilio, de modo que dos llamadas —un
 *    doble clic, un reintento de red, dos repartidores tocando la misma pantalla— producen
 *    la misma venta. Es el mismo mecanismo que protege al POS de las ventas duplicadas por
 *    red intermitente, reutilizado aquí en vez de inventar otro.
 */

interface InvoiceDeliveryInput {
  db: Kysely<Database>;
  logger: FastifyBaseLogger;
  tenantId: string;
  branchId: string;
  deliveryId: string;
  userId: string;
  userRole: string;
  cashSessionId: string;
  payments: SalePaymentInput[];
  requestLogContext: Record<string, unknown>;
}

interface DeliveryRow {
  id: string;
  status: string;
  sale_id: string | null;
  total_cents: number;
}

interface DeliveryItemRow {
  product_id: string;
  variant_id: string | null;
  qty: string;
}

/**
 * UUID v5-like determinista a partir del id del domicilio.
 *
 * Se usa un hash en vez de un `randomUUID()` para que el `client_uuid` sea siempre el mismo
 * para un domicilio dado: así la guarda de idempotencia que ya tiene `createSaleService`
 * devuelve la venta existente en lugar de crear una segunda.
 */
function deterministicClientUuid(deliveryId: string): string {
  const hash = createHash('sha256').update(`delivery:${deliveryId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // Versión 4 y variante RFC 4122, para que pase la validación `z.string().uuid()`.
    `4${hash.slice(13, 16)}`,
    `${((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
    hash.slice(20, 32)
  ].join('-');
}

export async function invoiceDeliveryUseCase(input: InvoiceDeliveryInput) {
  const { db, tenantId, branchId, deliveryId } = input;

  const { delivery, items } = await executeAsTenant(db, tenantId, async (trx) => {
    const found = await sql<DeliveryRow>`
      SELECT id, status, sale_id, total_cents
      FROM deliveries
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND id = ${deliveryId}
    `.execute(trx);

    const row = found.rows[0];
    if (!row) return { delivery: null, items: [] as DeliveryItemRow[] };

    const itemRows = await sql<DeliveryItemRow>`
      SELECT product_id, variant_id, qty::text AS qty
      FROM delivery_items
      WHERE tenant_id = ${tenantId} AND delivery_id = ${deliveryId}
    `.execute(trx);

    return { delivery: row, items: itemRows.rows };
  });

  if (!delivery) {
    throw new AppError(404, 'NOT_FOUND', 'Domicilio no encontrado');
  }

  // Ya facturado: se devuelve el mismo documento en vez de crear otro. Un domicilio con dos
  // facturas es un problema fiscal que hay que resolver con nota crédito.
  if (delivery.sale_id) {
    return { saleId: delivery.sale_id, alreadyInvoiced: true };
  }

  if (delivery.status === 'CANCELLED') {
    throw new AppError(409, 'DELIVERY_CANCELLED', 'Un domicilio cancelado no se puede facturar');
  }

  if (delivery.status !== 'DELIVERED') {
    // La factura se emite contra la entrega efectiva. Facturar un pedido que todavía va en
    // camino significa emitir un documento por algo que puede no llegar nunca.
    throw new AppError(
      409,
      'DELIVERY_NOT_DELIVERED',
      `El domicilio está en estado ${delivery.status}. Solo se factura un domicilio entregado.`
    );
  }

  if (items.length === 0) {
    throw new AppError(422, 'DELIVERY_WITHOUT_ITEMS', 'El domicilio no tiene ítems que facturar');
  }

  const result = await createSaleService({
    db,
    logger: input.logger,
    tenantId,
    userId: input.userId,
    userRole: input.userRole,
    requestLogContext: input.requestLogContext,
    payload: {
      client_uuid: deterministicClientUuid(deliveryId),
      branch_id: branchId,
      cash_session_id: input.cashSessionId,
      customer_id: null,
      table_order_id: null,
      waiterId: null,
      discount_cents: 0,
      tip_cents: 0,
      // Los precios y los impuestos los resuelve el servidor desde el catálogo, igual que en
      // una venta de mostrador: `deliveries.total_cents` es informativo y no se usa como
      // base gravable (D-039).
      items: items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        qty: Number(item.qty)
      })),
      payments: input.payments
    }
  });

  const saleId = result.sale.sale.id;

  await executeAsTenant(db, tenantId, async (trx) => {
    await sql`
      UPDATE deliveries
      SET sale_id = ${saleId}, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} AND id = ${deliveryId}
        AND sale_id IS NULL
    `.execute(trx);
  });

  return { saleId, alreadyInvoiced: false };
}
