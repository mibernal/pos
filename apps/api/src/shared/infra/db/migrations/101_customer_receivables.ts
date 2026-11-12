import { Kysely, sql } from 'kysely';

/**
 * Migración 101 — El fiado, como cuenta por cobrar de verdad.
 *
 * La 099 dejó que una venta se pagara con `STORE_CREDIT`, pero eso solo la clasificaba: el
 * importe salía del grupo «sin entrada de dinero» del Z y ahí se acababa. Nadie sabía a
 * quién se le debía, cuánto, ni desde cuándo.
 *
 * En una tienda de barrio colombiana el fiado no es una función avanzada: es la forma
 * normal de vender a la clientela conocida. Sin cupo, abonos y estado de cuenta, el
 * comercio lo lleva en un cuaderno y el POS se queda fuera de la mitad de su operación.
 *
 * Tres decisiones que se ven en el esquema:
 *
 * 1. **El saldo no se guarda como contador.** Se deriva de los pendientes. Un contador
 *    desincronizado es peor que no tenerlo, porque miente con confianza — el mismo
 *    razonamiento por el que `EntitlementGuard` cuenta el estado real en vez de mantener
 *    un acumulado.
 * 2. **El abono guarda su turno de caja.** Un abono en efectivo entra al cajón, así que
 *    tiene que llegar al arqueo. Si no, el turno cuadra de menos justo los días en que la
 *    gente viene a pagar lo que debe.
 * 3. **Los abonos se imputan a documentos concretos.** Sin la tabla de imputación se puede
 *    decir cuánto debe un cliente, pero no qué factura sigue abierta — y eso es lo primero
 *    que pregunta quien viene a pagar.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  /* --------------------------------------------------------------- *
   * Cupo del cliente
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('customer_credit_accounts')
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('customer_id', 'uuid', (col) => col.notNull().references('customers.id').onDelete('cascade'))
    /** Cupo máximo. `NULL` es sin límite; 0 es cliente sin fiado. */
    .addColumn('credit_limit_cents', 'integer')
    /** Días de plazo por defecto para las ventas a crédito de este cliente. */
    .addColumn('terms_days', 'integer', (col) => col.notNull().defaultTo(30))
    // ACTIVE · BLOCKED
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('ACTIVE'))
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addPrimaryKeyConstraint('pk_customer_credit_accounts', ['tenant_id', 'customer_id'])
    .execute();

  await sql`
    ALTER TABLE customer_credit_accounts
    ADD CONSTRAINT ck_customer_credit_accounts_status CHECK (status IN ('ACTIVE', 'BLOCKED'))
  `.execute(db);

  await sql`
    ALTER TABLE customer_credit_accounts
    ADD CONSTRAINT ck_customer_credit_accounts_limit
    CHECK (credit_limit_cents IS NULL OR credit_limit_cents >= 0)
  `.execute(db);

  /* --------------------------------------------------------------- *
   * Documentos por cobrar
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('customer_receivables')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('customer_id', 'uuid', (col) => col.notNull().references('customers.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull())
    /** La venta que lo originó. Nulo en un saldo inicial cargado a mano. */
    .addColumn('sale_id', 'uuid', (col) => col.references('sales.id').onDelete('set null'))
    .addColumn('original_cents', 'integer', (col) => col.notNull())
    /** Lo que queda por cobrar. Baja con cada imputación de abono. */
    .addColumn('balance_cents', 'integer', (col) => col.notNull())
    // OPEN · PAID · WRITTEN_OFF · VOID
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('OPEN'))
    .addColumn('due_at', 'timestamp')
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE customer_receivables
    ADD CONSTRAINT ck_customer_receivables_status
    CHECK (status IN ('OPEN', 'PAID', 'WRITTEN_OFF', 'VOID'))
  `.execute(db);

  /**
   * El saldo nunca puede pasarse del original ni bajar de cero. Es el invariante que impide
   * que un abono mal imputado deje al cliente debiendo un número negativo —o, peor, que le
   * borre una deuda que sí existe.
   */
  await sql`
    ALTER TABLE customer_receivables
    ADD CONSTRAINT ck_customer_receivables_balance
    CHECK (balance_cents >= 0 AND balance_cents <= original_cents AND original_cents > 0)
  `.execute(db);

  await sql`
    CREATE INDEX idx_customer_receivables_open
    ON customer_receivables (tenant_id, customer_id, created_at)
    WHERE status = 'OPEN'
  `.execute(db);

  await db.schema
    .createIndex('idx_customer_receivables_sale')
    .on('customer_receivables')
    .columns(['sale_id'])
    .execute();

  /* --------------------------------------------------------------- *
   * Abonos
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('customer_payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('customer_id', 'uuid', (col) => col.notNull().references('customers.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull())
    /**
     * El turno en el que se recibió. Un abono en efectivo entra al cajón: sin esta columna
     * el arqueo cuadraría de menos justo los días en que la gente viene a pagar lo que debe.
     */
    .addColumn('cash_session_id', 'uuid')
    .addColumn('method_code', 'varchar(30)', (col) => col.notNull())
    .addColumn('kind', 'varchar(20)', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('reference', 'varchar(80)')
    .addColumn('received_by_user_id', 'uuid', (col) => col.notNull())
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`ALTER TABLE customer_payments ADD CONSTRAINT ck_customer_payments_amount CHECK (amount_cents > 0)`.execute(db);

  /**
   * Un abono no se paga a crédito. Sin esto, «abonar con fiado» sería una forma perfecta de
   * hacer desaparecer una deuda sin que entrara un peso.
   */
  await sql`
    ALTER TABLE customer_payments
    ADD CONSTRAINT ck_customer_payments_kind
    CHECK (kind NOT IN ('STORE_CREDIT'))
  `.execute(db);

  await db.schema
    .createIndex('idx_customer_payments_customer')
    .on('customer_payments')
    .columns(['tenant_id', 'customer_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('idx_customer_payments_session')
    .on('customer_payments')
    .columns(['cash_session_id'])
    .execute();

  /* --------------------------------------------------------------- *
   * Imputación del abono a documentos
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('customer_payment_allocations')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('payment_id', 'uuid', (col) =>
      col.notNull().references('customer_payments.id').onDelete('cascade')
    )
    .addColumn('receivable_id', 'uuid', (col) =>
      col.notNull().references('customer_receivables.id').onDelete('cascade')
    )
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE customer_payment_allocations
    ADD CONSTRAINT ck_customer_payment_allocations_amount CHECK (amount_cents > 0)
  `.execute(db);

  await db.schema
    .createIndex('idx_customer_payment_allocations_payment')
    .on('customer_payment_allocations')
    .columns(['payment_id'])
    .execute();

  await db.schema
    .createIndex('idx_customer_payment_allocations_receivable')
    .on('customer_payment_allocations')
    .columns(['receivable_id'])
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('customer_payment_allocations').execute();
  await db.schema.dropTable('customer_payments').execute();
  await db.schema.dropTable('customer_receivables').execute();
  await db.schema.dropTable('customer_credit_accounts').execute();
}
