import { sql, type Transaction } from 'kysely';
import {
  classifyMenuItem,
  consumptionPerUnit,
  marginPercent,
  percentile,
  type MenuEngineeringRow,
  type PrepTimeRow,
  type SalesByHourRow,
  type TableTurnoverRow
} from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';

interface Rango {
  tenantId: string;
  branchId: string;
  from: string;
  to: string;
}

/** El día `to` entra entero: quien pide «del 1 al 5» espera que el 5 cuente. */
function ventana(from: string, to: string) {
  return { desde: new Date(`${from}T00:00:00`), hasta: new Date(`${to}T23:59:59.999`) };
}

export class OperationsReportsUseCase {
  /**
   * Rotación de mesa.
   *
   * La mesa se ocupa cuando se abre la cuenta y se libera cuando se cobra, así que el cierre
   * es la venta, no `table_orders.updated_at` —que se mueve cada vez que se añade un plato y
   * mediría «hasta la última comanda», no «hasta que se fueron»—.
   */
  static async tableTurnover(trx: Transaction<Database>, rango: Rango): Promise<TableTurnoverRow[]> {
    const { desde, hasta } = ventana(rango.from, rango.to);

    const filas = await trx
      .selectFrom('table_orders as to2')
      .innerJoin('sales as s', 's.table_order_id', 'to2.id')
      .innerJoin('tables as t', 't.id', 'to2.table_id')
      .select((eb) => [
        't.id as table_id',
        't.name as table_name',
        eb.fn.count<number>('s.id').as('services'),
        eb.fn.sum<number>('s.total_cents').as('total_cents'),
        eb.fn.coalesce(eb.fn.sum<number>('to2.guests_count'), eb.lit(0)).as('guests'),
        sql<number>`avg(extract(epoch from (s.created_at - to2.created_at)) / 60)`.as('avg_minutes')
      ])
      .where('to2.tenant_id', '=', rango.tenantId)
      .where('to2.branch_id', '=', rango.branchId)
      .where('s.status', '=', 'COMPLETED')
      .where('s.created_at', '>=', desde)
      .where('s.created_at', '<=', hasta)
      .groupBy(['t.id', 't.name'])
      .orderBy('t.name')
      .execute();

    return filas.map((fila) => {
      const servicios = Number(fila.services);
      const total = Number(fila.total_cents);
      return {
        table_id: fila.table_id,
        table_name: fila.table_name,
        services: servicios,
        avg_minutes: Number(Number(fila.avg_minutes ?? 0).toFixed(1)),
        avg_ticket_cents: servicios > 0 ? Math.round(total / servicios) : 0,
        total_cents: total,
        guests: Number(fila.guests)
      };
    });
  }

  /**
   * Tiempo de preparación por estación.
   *
   * Se mide contra `ready_at`, la marca que la migración 108 añadió porque `updated_at` se
   * pisa en cada transición. Un ticket con platos de dos estaciones cuenta para las dos: el
   * ticket es la unidad que la cocina despacha, y partirlo exigiría una marca por plato que
   * hoy nadie registra. Con la mayoría de comandas de una sola estación, la distorsión es
   * pequeña; decirlo importa más que esconderlo.
   */
  static async prepTime(trx: Transaction<Database>, rango: Rango): Promise<PrepTimeRow[]> {
    const { desde, hasta } = ventana(rango.from, rango.to);

    const filas = await trx
      .selectFrom('kitchen_tickets as kt')
      .innerJoin('kitchen_ticket_items as kti', 'kti.kitchen_ticket_id', 'kt.id')
      .innerJoin('products as p', 'p.id', 'kti.product_id')
      .select([
        'p.preparation_station as station',
        'kt.id as ticket_id',
        sql<number>`extract(epoch from (kt.ready_at - kt.created_at)) / 60`.as('minutes')
      ])
      .where('kt.tenant_id', '=', rango.tenantId)
      .where('kt.branch_id', '=', rango.branchId)
      .where('kt.ready_at', 'is not', null)
      .where('kt.created_at', '>=', desde)
      .where('kt.created_at', '<=', hasta)
      /**
       * Un ticket con tres platos de la misma estación es un tiempo, no tres: sin esto la
       * media se inclinaría hacia las comandas largas por el simple hecho de ser largas.
       */
      .distinctOn(['p.preparation_station', 'kt.id'])
      .execute();

    const porEstacion = new Map<string, number[]>();
    for (const fila of filas) {
      const minutos = Number(fila.minutes);
      if (!Number.isFinite(minutos) || minutos < 0) continue;
      const lista = porEstacion.get(fila.station) ?? [];
      lista.push(minutos);
      porEstacion.set(fila.station, lista);
    }

    return [...porEstacion.entries()]
      .map(([station, minutos]) => {
        const ordenados = [...minutos].sort((a, b) => a - b);
        const suma = ordenados.reduce((total, valor) => total + valor, 0);
        return {
          station,
          tickets: ordenados.length,
          avg_minutes: Number((suma / ordenados.length).toFixed(1)),
          p90_minutes: Number(percentile(ordenados, 0.9).toFixed(1))
        };
      })
      .sort((a, b) => b.avg_minutes - a.avg_minutes);
  }

  /** Ventas por franja horaria: a qué horas hay que tener gente. */
  static async salesByHour(trx: Transaction<Database>, rango: Rango): Promise<SalesByHourRow[]> {
    const { desde, hasta } = ventana(rango.from, rango.to);

    const filas = await trx
      .selectFrom('sales')
      .select((eb) => [
        sql<number>`extract(hour from created_at)`.as('hour'),
        eb.fn.count<number>('id').as('sales_count'),
        eb.fn.sum<number>('total_cents').as('total_cents')
      ])
      .where('tenant_id', '=', rango.tenantId)
      .where('branch_id', '=', rango.branchId)
      .where('status', '=', 'COMPLETED')
      .where('created_at', '>=', desde)
      .where('created_at', '<=', hasta)
      .groupBy(sql`extract(hour from created_at)`)
      .orderBy(sql`extract(hour from created_at)`)
      .execute();

    return filas.map((fila) => {
      const cuenta = Number(fila.sales_count);
      const total = Number(fila.total_cents);
      return {
        hour: Number(fila.hour),
        sales_count: cuenta,
        total_cents: total,
        avg_ticket_cents: cuenta > 0 ? Math.round(total / cuenta) : 0
      };
    });
  }

  /**
   * Ingeniería de menú: plato estrella contra plato lento.
   *
   * El costo sale del escandallo, no de `products.cost_cents` —que en un plato suele ser un
   * cero o un número escrito a mano—. Un plato sin receta aparece con margen nulo y sin
   * clasificar: es honesto decir «no lo sé» en vez de clasificarlo con un costo inventado.
   */
  static async menuEngineering(trx: Transaction<Database>, rango: Rango): Promise<MenuEngineeringRow[]> {
    const { desde, hasta } = ventana(rango.from, rango.to);

    const ventas = await trx
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .innerJoin('products as p', 'p.id', 'si.product_id')
      .select((eb) => [
        'p.id as product_id',
        'p.name as product_name',
        'p.price_cents',
        eb.fn.sum<number>('si.qty').as('qty_sold'),
        eb.fn.sum<number>('si.line_total_cents').as('revenue_cents')
      ])
      .where('s.tenant_id', '=', rango.tenantId)
      .where('s.branch_id', '=', rango.branchId)
      .where('s.status', '=', 'COMPLETED')
      .where('s.created_at', '>=', desde)
      .where('s.created_at', '<=', hasta)
      .groupBy(['p.id', 'p.name', 'p.price_cents'])
      .execute();

    if (ventas.length === 0) return [];

    const costos = await this.theoreticalCosts(
      trx,
      rango.tenantId,
      ventas.map((venta) => venta.product_id)
    );

    const parciales = ventas.map((venta) => {
      const costo = costos.get(venta.product_id) ?? null;
      const precio = Number(venta.price_cents);
      return {
        product_id: venta.product_id,
        product_name: venta.product_name,
        qty_sold: Number(venta.qty_sold),
        revenue_cents: Number(venta.revenue_cents),
        price_cents: precio,
        theoretical_cost_cents: costo,
        margin_percent: costo === null ? null : marginPercent(precio, costo)
      };
    });

    const conMargen = parciales.filter((fila) => fila.margin_percent !== null);
    const cantidadMedia = parciales.reduce((total, fila) => total + fila.qty_sold, 0) / parciales.length;
    const margenMedio =
      conMargen.length > 0
        ? conMargen.reduce((total, fila) => total + (fila.margin_percent ?? 0), 0) / conMargen.length
        : 0;

    return parciales
      .map((fila) => ({
        ...fila,
        classification: classifyMenuItem(fila.qty_sold, fila.margin_percent, cantidadMedia, margenMedio)
      }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents);
  }

  /**
   * Costo teórico de cada plato con receta, en una sola pasada.
   *
   * No sigue recetas anidadas: aquí importa el orden de magnitud sobre la carta entera, y
   * una consulta por plato para afinar un ingrediente que a su vez es receta —la salsa—
   * convertiría un informe en cien consultas. El escandallo de la ficha del plato sí las
   * sigue, y es donde se fija el precio.
   */
  private static async theoreticalCosts(
    trx: Transaction<Database>,
    tenantId: string,
    productIds: string[]
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();

    const filas = await trx
      .selectFrom('product_recipes as pr')
      .innerJoin('recipe_components as rc', 'rc.recipe_id', 'pr.id')
      .innerJoin('products as ing', 'ing.id', 'rc.ingredient_product_id')
      .select(['pr.product_id', 'pr.yield_qty', 'rc.qty', 'rc.waste_percent', 'ing.cost_cents'])
      .where('pr.tenant_id', '=', tenantId)
      .where('pr.active', '=', true)
      .where('pr.variant_id', 'is', null)
      .where('pr.product_id', 'in', productIds)
      .execute();

    const acumulado = new Map<string, number>();
    for (const fila of filas) {
      const porUnidad = consumptionPerUnit(
        Number(fila.qty),
        Number(fila.waste_percent),
        Number(fila.yield_qty)
      );
      acumulado.set(
        fila.product_id,
        (acumulado.get(fila.product_id) ?? 0) + porUnidad * Number(fila.cost_cents)
      );
    }

    return new Map([...acumulado.entries()].map(([id, costo]) => [id, Math.round(costo)]));
  }
}
