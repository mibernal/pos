import { Kysely, sql } from 'kysely';

/**
 * Las constantes se copian aquí en vez de importarlas de `@pos-dian/shared`, siguiendo lo
 * que hace el resto de migraciones del proyecto. No es duplicación por descuido: una
 * migración tiene que producir el mismo resultado dentro de dos años, y si leyera una
 * constante compartida, cambiarla mañana haría que una base nueva se construyera distinta
 * de las que ya existen. El código vivo sí usa el paquete compartido; esto es historia.
 */
const PAYMENT_KINDS = [
  'CASH',
  'CARD',
  'TRANSFER',
  'WALLET',
  'GIFT_CARD',
  'STORE_CREDIT',
  'POINTS',
  'VOUCHER'
] as const;

const DEFAULT_PAYMENT_METHODS = [
  { code: 'CASH', kind: 'CASH', label: 'Efectivo', active: true, requiresReference: false, sort_order: 10 },
  { code: 'CARD', kind: 'CARD', label: 'Tarjeta', active: true, requiresReference: true, sort_order: 20 },
  { code: 'TRANSFER', kind: 'TRANSFER', label: 'Transferencia', active: true, requiresReference: false, sort_order: 30 },
  { code: 'NEQUI', kind: 'WALLET', label: 'Nequi', active: false, requiresReference: false, sort_order: 40 },
  { code: 'DAVIPLATA', kind: 'WALLET', label: 'Daviplata', active: false, requiresReference: false, sort_order: 50 },
  { code: 'BRE_B', kind: 'WALLET', label: 'Bre-B', active: false, requiresReference: false, sort_order: 60 },
  { code: 'GIFT_CARD', kind: 'GIFT_CARD', label: 'Bono regalo', active: false, requiresReference: true, sort_order: 70 },
  { code: 'STORE_CREDIT', kind: 'STORE_CREDIT', label: 'Fiado', active: false, requiresReference: false, sort_order: 80 },
  { code: 'POINTS', kind: 'POINTS', label: 'Puntos', active: false, requiresReference: false, sort_order: 90 },
  { code: 'VOUCHER', kind: 'VOUCHER', label: 'Vale', active: false, requiresReference: true, sort_order: 100 }
] as const;

/**
 * Migración 099 — Los pagos dejan de ser un JSON y pasan a ser filas.
 *
 * `sales.payment_json` guardaba todos los pagos de una venta en un blob sin forma fija, y
 * eso se nota en tres sitios que hoy no se hablan entre ellos:
 *
 * 1. `cash-sessions-service.ts` tiene una lista de **quince rutas posibles**
 *    (`cash_cents`, `cash.amount_cents`, `amounts.cashAmountCents`…) para adivinar cuánto
 *    efectivo entró. Esa lista es el fósil de un formato que cambió varias veces sin que
 *    nadie migrara lo anterior.
 * 2. El cierre de caja construye el desglose con un objeto literal de tres claves y un
 *    `if (methodRevenues[method] !== undefined)`: cualquier medio que no sea CASH, CARD o
 *    TRANSFER **se descarta en silencio**.
 * 3. El informe de ingresos por método repite esa misma suma por su cuenta, en otro
 *    archivo, con su propio criterio.
 *
 * Con los pagos como filas, el arqueo y el Z son un `GROUP BY` y añadir un medio deja de
 * ser tocar tres agregaciones y esperar que coincidan.
 *
 * `payment_json` se conserva: es lo que la venta envió y sirve de respaldo del backfill.
 * Deja de ser la fuente de verdad, que es lo que importa.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  /* --------------------------------------------------------------- *
   * Catálogo de medios por comercio
   * --------------------------------------------------------------- */

  /**
   * Un comercio no cobra con «WALLET»: cobra con Nequi o con Daviplata. El tipo dice cómo
   * se comporta el dinero —si toca el cajón, si entra hoy—; el catálogo dice cómo se llama
   * y si está encendido. Así, añadir un medio es una fila y no un despliegue.
   */
  await db.schema
    .createTable('payment_method_catalog')
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('code', 'varchar(30)', (col) => col.notNull())
    .addColumn('kind', 'varchar(20)', (col) => col.notNull())
    .addColumn('label', 'varchar(60)', (col) => col.notNull())
    .addColumn('active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('requires_reference', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(100))
    // Los del sistema no se borran: hay ventas históricas que los referencian.
    .addColumn('is_system', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addPrimaryKeyConstraint('pk_payment_method_catalog', ['tenant_id', 'code'])
    .execute();

  await sql`
    ALTER TABLE payment_method_catalog
    ADD CONSTRAINT ck_payment_method_catalog_kind
    CHECK (kind IN (${sql.join(PAYMENT_KINDS.map((kind) => sql.lit(kind)))}))
  `.execute(db);

  // Siembra para los comercios que ya existen. Los tres primeros encendidos —son los que el
  // sistema ya cobraba— y el resto apagados: encenderle a alguien un medio que no usa le
  // añade un botón que confunde al cajero y una línea del Z que siempre dice cero.
  for (const method of DEFAULT_PAYMENT_METHODS) {
    await sql`
      INSERT INTO payment_method_catalog (tenant_id, code, kind, label, active, requires_reference, sort_order, is_system)
      SELECT
        t.id,
        ${method.code},
        ${method.kind},
        ${method.label},
        ${method.active},
        ${method.requiresReference},
        ${method.sort_order},
        true
      FROM tenants t
      ON CONFLICT (tenant_id, code) DO NOTHING
    `.execute(db);
  }

  /* --------------------------------------------------------------- *
   * Pagos de la venta
   * --------------------------------------------------------------- */

  await db.schema
    .createTable('sale_payments')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull())
    .addColumn('sale_id', 'uuid', (col) => col.notNull().references('sales.id').onDelete('cascade'))
    // Denormalizado desde la venta: el arqueo agrupa por turno sin tener que unir con sales.
    .addColumn('cash_session_id', 'uuid', (col) => col.notNull())
    .addColumn('method_code', 'varchar(30)', (col) => col.notNull())
    /**
     * El tipo se copia, no se une contra el catálogo. Si mañana el comercio renombra o
     * apaga «Nequi», el Z del mes pasado tiene que seguir diciendo lo que dijo: el
     * comportamiento del dinero es un hecho del momento del cobro, no una propiedad
     * editable a posteriori.
     */
    .addColumn('kind', 'varchar(20)', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    /** Efectivo entregado por el cliente, y el vuelto que salió del mismo cajón. */
    .addColumn('tendered_cents', 'integer')
    .addColumn('change_cents', 'integer')
    /** Aprobación del datáfono, referencia de la billetera, código del bono, número del vale. */
    .addColumn('reference', 'varchar(80)')
    .addColumn('metadata_json', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE sale_payments
    ADD CONSTRAINT ck_sale_payments_kind
    CHECK (kind IN (${sql.join(PAYMENT_KINDS.map((kind) => sql.lit(kind)))}))
  `.execute(db);

  await sql`ALTER TABLE sale_payments ADD CONSTRAINT ck_sale_payments_amount CHECK (amount_cents > 0)`.execute(db);

  /**
   * El vuelto es una consecuencia, no un dato suelto: si hay entrega, tiene que ser al menos
   * el importe, y el cambio exactamente la diferencia. Sin este CHECK, un vuelto mal
   * calculado descuadra el cajón y no hay dónde verlo.
   */
  await sql`
    ALTER TABLE sale_payments
    ADD CONSTRAINT ck_sale_payments_change
    CHECK (
      (tendered_cents IS NULL AND change_cents IS NULL)
      OR (tendered_cents >= amount_cents AND change_cents = tendered_cents - amount_cents)
    )
  `.execute(db);

  await db.schema.createIndex('idx_sale_payments_sale').on('sale_payments').columns(['sale_id']).execute();
  await db.schema
    .createIndex('idx_sale_payments_session')
    .on('sale_payments')
    .columns(['cash_session_id'])
    .execute();
  await db.schema
    .createIndex('idx_sale_payments_tenant_date')
    .on('sale_payments')
    .columns(['tenant_id', 'created_at'])
    .execute();

  /* --------------------------------------------------------------- *
   * Backfill
   * --------------------------------------------------------------- */

  /**
   * Caso normal: `payment_json.payments` es un array, que es la forma que escribe
   * `create-sale.service` desde hace tiempo.
   */
  await sql`
    INSERT INTO sale_payments (
      id, tenant_id, branch_id, sale_id, cash_session_id, method_code, kind, amount_cents, reference, created_at
    )
    SELECT
      gen_random_uuid(),
      s.tenant_id,
      s.branch_id,
      s.id,
      s.cash_session_id,
      upper(p->>'method'),
      upper(p->>'method'),
      (p->>'amount_cents')::int,
      nullif(p->>'approval_code', ''),
      s.created_at
    FROM sales s
    CROSS JOIN LATERAL jsonb_array_elements(s.payment_json->'payments') AS p
    WHERE jsonb_typeof(s.payment_json->'payments') = 'array'
      AND upper(p->>'method') IN (${sql.join(PAYMENT_KINDS.map((kind) => sql.lit(kind)))})
      AND coalesce((p->>'amount_cents')::int, 0) > 0
  `.execute(db);

  /**
   * Formas anteriores: sin array de pagos. Se reconstruye un único pago con el modo que
   * declare el JSON.
   *
   * Un método que no se reconozca se guarda como `LEGACY` en vez de suponer efectivo.
   * Suponerlo sería inventar dinero en el cajón de un turno histórico, y `LEGACY` no toca
   * el cajón: la fila queda, es visible, y nadie cuadra sobre una suposición nuestra. Los
   * turnos ya cerrados conservan además su `expected_cash_cents` y su `diff_cents`, así que
   * este backfill no reescribe ningún arqueo pasado.
   */
  await sql`
    INSERT INTO sale_payments (
      id, tenant_id, branch_id, sale_id, cash_session_id, method_code, kind, amount_cents, created_at
    )
    SELECT
      gen_random_uuid(),
      s.tenant_id,
      s.branch_id,
      s.id,
      s.cash_session_id,
      CASE
        WHEN upper(coalesce(s.payment_json->>'mode', s.payment_json->>'payment_method', s.payment_json->>'method', ''))
             IN (${sql.join(PAYMENT_KINDS.map((kind) => sql.lit(kind)))})
        THEN upper(coalesce(s.payment_json->>'mode', s.payment_json->>'payment_method', s.payment_json->>'method'))
        ELSE 'LEGACY'
      END,
      CASE
        WHEN upper(coalesce(s.payment_json->>'mode', s.payment_json->>'payment_method', s.payment_json->>'method', ''))
             IN (${sql.join(PAYMENT_KINDS.map((kind) => sql.lit(kind)))})
        THEN upper(coalesce(s.payment_json->>'mode', s.payment_json->>'payment_method', s.payment_json->>'method'))
        ELSE 'VOUCHER'
      END,
      coalesce(nullif(s.payment_json->>'total_cents', '')::int, s.total_cents),
      s.created_at
    FROM sales s
    WHERE jsonb_typeof(s.payment_json->'payments') IS DISTINCT FROM 'array'
      AND coalesce(nullif(s.payment_json->>'total_cents', '')::int, s.total_cents) > 0
  `.execute(db);

  // La entrada `LEGACY` del catálogo solo existe donde el backfill la necesitó.
  await sql`
    INSERT INTO payment_method_catalog (tenant_id, code, kind, label, active, requires_reference, sort_order, is_system)
    SELECT DISTINCT sp.tenant_id, 'LEGACY', 'VOUCHER', 'Medio histórico sin identificar', false, false, 900, true
    FROM sale_payments sp
    WHERE sp.method_code = 'LEGACY'
    ON CONFLICT (tenant_id, code) DO NOTHING
  `.execute(db);

  /* --------------------------------------------------------------- *
   * Desglose congelado del turno
   * --------------------------------------------------------------- */

  /**
   * El desglose se guarda al cerrar el turno.
   *
   * Reimprimir un Z de hace tres meses tiene que devolver lo que ese Z decía, aunque desde
   * entonces se hayan anulado ventas o renombrado medios. Recalcularlo cada vez convierte un
   * documento de cierre en una consulta cuyo resultado cambia solo.
   */
  await db.schema.alterTable('cash_sessions').addColumn('payment_breakdown_json', 'jsonb').execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('cash_sessions').dropColumn('payment_breakdown_json').execute();
  await db.schema.dropTable('sale_payments').execute();
  await db.schema.dropTable('payment_method_catalog').execute();
}
