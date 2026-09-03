import { Kysely, sql } from 'kysely';

/**
 * Migración 097 — Lo que hace falta para que un cobro ocurra solo.
 *
 * El motor de renovación existía desde el principio con los cobros comentados
 * (`// await chargeMethod()`), y no por descuido: cobrar de verdad necesita cuatro cosas
 * que no estaban en el esquema.
 *
 * 1. **Un método de pago que sobreviva al checkout.** `tenant_subscriptions` tenía una
 *    columna `payment_method_token` suelta, sin saber de qué pasarela era, cuándo vence ni
 *    si sigue sirviendo. Una tabla propia permite además tener el anterior mientras el
 *    comercio registra el nuevo.
 * 2. **Una factura.** Sin ella, un cobro es un apunte en `payment_transactions` que no
 *    dice qué se cobró ni por qué periodo, y el comercio no tiene nada que darle a su
 *    contador. Con consecutivo propio, IVA desglosado e histórico descargable — `SU-06`.
 * 3. **Un rastro de la cobranza.** Para responder «¿por qué está suspendido este
 *    comercio?» sin leer logs, y para que el aviso de los 7 días se envíe una sola vez
 *    aunque el scheduler corra dos veces al día. Esa idempotencia es el índice único.
 * 4. **Descuentos.** Ciclo anual, cupones y cortesías tienen que vivir en datos: un
 *    descuento hardcodeado no se puede conceder a un cliente sin desplegar.
 *
 * Los permisos de `api_user` los hereda del `ALTER DEFAULT PRIVILEGES` que la 093 dejó a
 * nombre del rol que migra. El aislamiento por RLS lo pone la 098.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  /* --------------------------------------------------------------- *
   * Métodos de pago tokenizados
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('tenant_payment_methods')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('gateway', 'varchar(50)', (col) => col.notNull())
    /**
     * El token de la pasarela. En Wompi es el `payment_source_id`: una referencia que solo
     * sirve para cobrar desde nuestra cuenta y que no contiene el número de la tarjeta.
     * El número nunca pasa por aquí — lo tokeniza el navegador con la llave pública.
     */
    .addColumn('gateway_token', 'varchar(255)', (col) => col.notNull())
    .addColumn('brand', 'varchar(40)')
    .addColumn('last_four', 'varchar(4)')
    .addColumn('exp_month', 'integer')
    .addColumn('exp_year', 'integer')
    .addColumn('holder_name', 'varchar(150)')
    // ACTIVE · EXPIRED · REMOVED
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('ACTIVE'))
    .addColumn('is_default', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('metadata_json', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // Un solo método por defecto y por comercio. Parcial: los retirados no compiten.
  await sql`
    CREATE UNIQUE INDEX uq_tenant_payment_methods_default
    ON tenant_payment_methods (tenant_id)
    WHERE is_default AND status = 'ACTIVE'
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_tenant_payment_methods_token
    ON tenant_payment_methods (gateway, gateway_token)
  `.execute(db);

  await db.schema
    .createIndex('idx_tenant_payment_methods_tenant')
    .on('tenant_payment_methods')
    .columns(['tenant_id', 'status'])
    .execute();

  /* --------------------------------------------------------------- *
   * Consecutivo de facturación
   * --------------------------------------------------------------- */

  /**
   * Tabla y no `SEQUENCE` a propósito. Una secuencia de Postgres no retrocede: cada
   * transacción abortada deja un hueco, y un consecutivo de facturación con huecos es
   * exactamente lo que un auditor pregunta. El `UPDATE ... RETURNING` serializa a quien
   * pida número y solo deja hueco si esa misma transacción se deshace — el mismo caso en
   * el que tampoco hay factura.
   */
  await db.schema
    .createTable('billing_invoice_sequences')
    .addColumn('scope', 'varchar(40)', (col) => col.primaryKey())
    .addColumn('prefix', 'varchar(20)', (col) => col.notNull())
    .addColumn('last_number', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await db
    .insertInto('billing_invoice_sequences')
    .values({ scope: 'DEFAULT', prefix: 'POS', last_number: 0 })
    .execute();

  /* --------------------------------------------------------------- *
   * Cupones y cortesías
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('billing_coupons')
    .addColumn('code', 'varchar(40)', (col) => col.primaryKey())
    .addColumn('description', 'varchar(200)')
    // PERCENT (1–100) · FIXED (centavos)
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    .addColumn('value', 'numeric(12, 2)', (col) => col.notNull())
    // ONCE · REPEATING · FOREVER
    .addColumn('duration', 'varchar(20)', (col) => col.notNull().defaultTo('ONCE'))
    .addColumn('duration_periods', 'integer')
    .addColumn('max_redemptions', 'integer')
    .addColumn('redeemed_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('valid_from', 'timestamp')
    .addColumn('valid_until', 'timestamp')
    .addColumn('active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE billing_coupons
    ADD CONSTRAINT ck_billing_coupons_type CHECK (type IN ('PERCENT', 'FIXED'))
  `.execute(db);

  await sql`
    ALTER TABLE billing_coupons
    ADD CONSTRAINT ck_billing_coupons_duration CHECK (duration IN ('ONCE', 'REPEATING', 'FOREVER'))
  `.execute(db);

  await db.schema
    .createTable('tenant_coupon_redemptions')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('coupon_code', 'varchar(40)', (col) => col.notNull().references('billing_coupons.code'))
    .addColumn('redeemed_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  // Un cupón se canjea una vez por comercio: si no, `REPEATING` de 3 periodos se convierte
  // en descuento perpetuo aplicándolo de nuevo cada vez que se acaba.
  await sql`
    CREATE UNIQUE INDEX uq_tenant_coupon_redemptions
    ON tenant_coupon_redemptions (tenant_id, coupon_code)
  `.execute(db);

  /* --------------------------------------------------------------- *
   * Facturas de la suscripción
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('subscription_invoices')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('subscription_id', 'uuid', (col) => col.notNull())
    .addColumn('number', 'varchar(40)', (col) => col.notNull().unique())
    // DRAFT · OPEN · PAID · VOID · UNCOLLECTIBLE
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('OPEN'))
    .addColumn('plan_id', 'varchar(50)', (col) => col.notNull())
    .addColumn('plan_name', 'varchar(100)', (col) => col.notNull())
    .addColumn('billing_cycle', 'varchar(20)', (col) => col.notNull())
    .addColumn('period_start', 'timestamp', (col) => col.notNull())
    .addColumn('period_end', 'timestamp', (col) => col.notNull())
    .addColumn('subtotal_cents', 'integer', (col) => col.notNull())
    .addColumn('discount_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('tax_cents', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('total_cents', 'integer', (col) => col.notNull())
    .addColumn('currency', 'varchar(3)', (col) => col.notNull().defaultTo('COP'))
    .addColumn('coupon_code', 'varchar(40)')
    .addColumn('payment_transaction_id', 'uuid')
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('issued_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('due_at', 'timestamp')
    .addColumn('paid_at', 'timestamp')
    .addColumn('metadata_json', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE subscription_invoices
    ADD CONSTRAINT ck_subscription_invoices_status
    CHECK (status IN ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE'))
  `.execute(db);

  // El total tiene que cuadrar con el desglose, siempre. Es la misma disciplina que
  // `ck_sales_total_formula` aplica a las ventas del comercio.
  await sql`
    ALTER TABLE subscription_invoices
    ADD CONSTRAINT ck_subscription_invoices_total
    CHECK (total_cents = subtotal_cents - discount_cents + tax_cents)
  `.execute(db);

  /**
   * Una factura por suscripción y periodo. Es lo que hace que el motor pueda correr cada
   * hora sin miedo: si la factura del periodo ya existe, no se emite otra.
   */
  await sql`
    CREATE UNIQUE INDEX uq_subscription_invoices_period
    ON subscription_invoices (subscription_id, period_start)
    WHERE status <> 'VOID'
  `.execute(db);

  await db.schema
    .createIndex('idx_subscription_invoices_tenant')
    .on('subscription_invoices')
    .columns(['tenant_id', 'issued_at'])
    .execute();

  await sql`
    CREATE INDEX idx_subscription_invoices_open
    ON subscription_invoices (due_at)
    WHERE status = 'OPEN'
  `.execute(db);

  await db.schema
    .createTable('subscription_invoice_items')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('invoice_id', 'uuid', (col) =>
      col.notNull().references('subscription_invoices.id').onDelete('cascade')
    )
    .addColumn('description', 'varchar(250)', (col) => col.notNull())
    .addColumn('quantity', 'numeric(10, 2)', (col) => col.notNull().defaultTo(1))
    .addColumn('unit_price_cents', 'integer', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createIndex('idx_subscription_invoice_items_invoice')
    .on('subscription_invoice_items')
    .columns(['invoice_id'])
    .execute();

  /* --------------------------------------------------------------- *
   * Rastro de la cobranza
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('dunning_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('subscription_id', 'uuid', (col) => col.notNull())
    .addColumn('invoice_id', 'uuid')
    .addColumn('step', 'varchar(30)', (col) => col.notNull())
    /**
     * Qué periodo de facturación es este, como texto (`2026-09-01`). Junto con el paso y
     * el intento forma la llave de idempotencia: el aviso de los 7 días del periodo de
     * septiembre existe una sola vez, corra el scheduler las veces que corra.
     */
    .addColumn('period_key', 'varchar(20)', (col) => col.notNull())
    .addColumn('attempt', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('notified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('detail', 'text')
    .addColumn('metadata_json', 'jsonb')
    .addColumn('occurred_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_dunning_events_step
    ON dunning_events (subscription_id, step, period_key, attempt)
  `.execute(db);

  await db.schema
    .createIndex('idx_dunning_events_tenant')
    .on('dunning_events')
    .columns(['tenant_id', 'occurred_at'])
    .execute();

  /* --------------------------------------------------------------- *
   * Suscripción: lo que el motor necesita saber
   * --------------------------------------------------------------- */

  await db.schema
    .alterTable('tenant_subscriptions')
    .addColumn('payment_method_id', 'uuid', (col) => col.references('tenant_payment_methods.id').onDelete('set null'))
    .execute();

  await db.schema.alterTable('tenant_subscriptions').addColumn('coupon_code', 'varchar(40)').execute();

  // Cuántos periodos le quedan al descuento. `NULL` con cupón `FOREVER` es cortesía
  // permanente; 0 es cupón agotado que ya no se aplica.
  await db.schema.alterTable('tenant_subscriptions').addColumn('coupon_periods_left', 'integer').execute();

  await db.schema.alterTable('tenant_subscriptions').addColumn('next_retry_at', 'timestamp').execute();

  await db.schema.alterTable('tenant_subscriptions').addColumn('dunning_stage', 'varchar(30)').execute();

  /**
   * Los índices que el motor recorre cada hora. Parciales, porque la inmensa mayoría de
   * las suscripciones no tienen nada pendiente y no deberían ni entrar en el índice.
   */
  await sql`
    CREATE INDEX idx_tenant_subscriptions_due
    ON tenant_subscriptions (next_billing_at)
    WHERE status = 'ACTIVE' AND next_billing_at IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_tenant_subscriptions_retry
    ON tenant_subscriptions (next_retry_at)
    WHERE status = 'PAST_DUE' AND next_retry_at IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX idx_tenant_subscriptions_trial_end
    ON tenant_subscriptions (trial_ends_at)
    WHERE status = 'TRIAL'
  `.execute(db);

  /**
   * Las suscripciones que ya existen no tienen `next_billing_at`, así que el motor no las
   * vería nunca. Se les fija el que corresponde a su periodo actual: el cobro recurrente
   * empieza a aplicar sobre la cartera existente sin que nadie toque nada a mano.
   */
  await sql`
    UPDATE tenant_subscriptions
    SET next_billing_at = current_period_end
    WHERE next_billing_at IS NULL
      AND status IN ('ACTIVE', 'PAST_DUE')
      AND current_period_end IS NOT NULL
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_tenant_subscriptions_trial_end`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_tenant_subscriptions_retry`.execute(db);
  await sql`DROP INDEX IF EXISTS idx_tenant_subscriptions_due`.execute(db);

  for (const column of ['dunning_stage', 'next_retry_at', 'coupon_periods_left', 'coupon_code', 'payment_method_id']) {
    await db.schema.alterTable('tenant_subscriptions').dropColumn(column).execute();
  }

  await db.schema.dropTable('dunning_events').execute();
  await db.schema.dropTable('subscription_invoice_items').execute();
  await db.schema.dropTable('subscription_invoices').execute();
  await db.schema.dropTable('tenant_coupon_redemptions').execute();
  await db.schema.dropTable('billing_coupons').execute();
  await db.schema.dropTable('billing_invoice_sequences').execute();
  await db.schema.dropTable('tenant_payment_methods').execute();
}
