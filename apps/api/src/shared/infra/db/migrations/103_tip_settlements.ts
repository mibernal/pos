import { Kysely, sql } from 'kysely';

/**
 * Migración 103 — La propina se liquida, no solo se cobra.
 *
 * `tip_cents` existía desde la migración 063 y su único consumidor era un `SUM` en el
 * informe de meseros. Ahí terminaba: no había reparto, ni distinción entre propina en
 * efectivo y en tarjeta, ni pago al cierre, ni el movimiento de caja que saca del cajón la
 * propina en efectivo.
 *
 * Ese último punto es el que descuadra arqueos. La propina en efectivo **está** en el cajón
 * —el cliente la dejó ahí— y el efectivo esperado la cuenta, correctamente. Pero cuando al
 * final del turno el mesero se lleva lo suyo, sale dinero que nadie registró: el cajero
 * cuenta menos de lo esperado y la diferencia aparece como faltante. Con la liquidación,
 * ese pago genera su movimiento de caja y el turno vuelve a cuadrar.
 *
 * La propina cobrada con tarjeta es distinta: no está en el cajón, la recibió el comercio y
 * se la debe al mesero. Por eso se guardan separadas — pagarlas igual sería sacar del cajón
 * un dinero que nunca entró en él.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  /* --------------------------------------------------------------- *
   * Política de propina del comercio
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('tenant_tip_settings')
    .addColumn('tenant_id', 'uuid', (col) =>
      col.primaryKey().references('tenants.id').onDelete('cascade')
    )
    // INDIVIDUAL: cada mesero se lleva lo suyo · POOL: bolsa común repartida por partes iguales
    .addColumn('policy', 'varchar(20)', (col) => col.notNull().defaultTo('INDIVIDUAL'))
    /**
     * Si al cerrar el turno se liquida sola. Apagado por defecto: pagar propinas es un acto
     * con dinero de por medio y no debería ocurrir como efecto secundario de cerrar caja.
     */
    .addColumn('auto_settle_on_close', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE tenant_tip_settings
    ADD CONSTRAINT ck_tenant_tip_settings_policy CHECK (policy IN ('INDIVIDUAL', 'POOL'))
  `.execute(db);

  /* --------------------------------------------------------------- *
   * Reparto de la propina entre los medios de pago de la venta
   * --------------------------------------------------------------- */

  /**
   * La propina viaja **dentro** del importe cobrado —`total_cents = subtotal − descuento +
   * propina`, según el CHECK de `sales`— así que en una venta mixta hay que decidir qué
   * parte llegó en efectivo. Se reparte en proporción a lo que pagó cada medio: una cuenta
   * de 100 con 20 de propina pagada mitad y mitad deja 10 en el cajón y 10 en la tarjeta.
   *
   * Es una convención, no una verdad: el cliente no dijo con qué medio dejaba la propina.
   * Pero es la única que reparte sin inventar, y sobre todo es **una sola**, escrita en un
   * sitio, en vez de que cada informe suponga la suya.
   */
  await db.schema
    .alterTable('sale_payments')
    .addColumn('tip_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await sql`
    ALTER TABLE sale_payments ADD CONSTRAINT ck_sale_payments_tip CHECK (tip_cents >= 0 AND tip_cents <= amount_cents)
  `.execute(db);

  /**
   * Reparto del histórico. Las ventas de un solo pago se llevan la propina entera; las
   * mixtas, la parte proporcional, y el redondeo va al pago mayor para que la suma cuadre
   * con `sales.tip_cents` exactamente.
   */
  await sql`
    WITH totales AS (
      SELECT sale_id, SUM(amount_cents) AS pagado
      FROM sale_payments
      GROUP BY sale_id
    )
    UPDATE sale_payments sp
    SET tip_cents = LEAST(
      sp.amount_cents,
      FLOOR(s.tip_cents::numeric * sp.amount_cents / t.pagado)::int
    )
    FROM sales s, totales t
    WHERE s.id = sp.sale_id
      AND t.sale_id = sp.sale_id
      AND s.tip_cents > 0
      AND t.pagado > 0
  `.execute(db);

  /**
   * El resto del redondeo va al pago mayor de cada venta, para que la suma de las partes
   * sea exactamente `sales.tip_cents` y no un peso menos.
   */
  await sql`
    WITH faltante AS (
      SELECT
        sp.sale_id,
        s.tip_cents - SUM(sp.tip_cents) AS resto,
        (ARRAY_AGG(sp.id ORDER BY sp.amount_cents DESC, sp.id))[1] AS mayor
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE s.tip_cents > 0
      GROUP BY sp.sale_id, s.tip_cents
      HAVING s.tip_cents - SUM(sp.tip_cents) > 0
    )
    UPDATE sale_payments sp
    SET tip_cents = LEAST(sp.amount_cents, sp.tip_cents + f.resto::int)
    FROM faltante f
    WHERE sp.id = f.mayor
  `.execute(db);

  /* --------------------------------------------------------------- *
   * Liquidación
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('tip_settlements')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull())
    .addColumn('cash_session_id', 'uuid', (col) => col.notNull())
    .addColumn('policy', 'varchar(20)', (col) => col.notNull())
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    /** Lo que estaba en el cajón y sale de él al pagarlo. */
    .addColumn('cash_cents', 'integer', (col) => col.notNull())
    /** Lo cobrado con tarjeta o billetera: el comercio lo tiene, se lo debe al mesero. */
    .addColumn('electronic_cents', 'integer', (col) => col.notNull())
    .addColumn('settled_by_user_id', 'uuid', (col) => col.notNull())
    .addColumn('cash_movement_id', 'uuid')
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  /** Un turno se liquida una sola vez: pagar dos veces la misma propina es dinero perdido. */
  await sql`
    CREATE UNIQUE INDEX uq_tip_settlements_session ON tip_settlements (cash_session_id)
  `.execute(db);

  await db.schema
    .createTable('tip_settlement_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('settlement_id', 'uuid', (col) =>
      col.notNull().references('tip_settlements.id').onDelete('cascade')
    )
    /** Nulo cuando la venta no tuvo mesero asignado y la propina va a la bolsa común. */
    .addColumn('waiter_id', 'uuid')
    .addColumn('waiter_name', 'varchar(150)', (col) => col.notNull())
    .addColumn('sales_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('earned_cents', 'integer', (col) => col.notNull())
    .addColumn('cash_cents', 'integer', (col) => col.notNull())
    .addColumn('electronic_cents', 'integer', (col) => col.notNull())
    .execute();

  await db.schema
    .createIndex('idx_tip_settlement_items_settlement')
    .on('tip_settlement_items')
    .columns(['settlement_id'])
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('tip_settlement_items').execute();
  await db.schema.dropTable('tip_settlements').execute();
  await db.schema.alterTable('sale_payments').dropColumn('tip_cents').execute();
  await db.schema.dropTable('tenant_tip_settings').execute();
}
