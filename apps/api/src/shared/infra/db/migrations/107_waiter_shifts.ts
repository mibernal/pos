import { Kysely, sql } from 'kysely';

/**
 * Migración 107 — Identidad del mesero y turnos reales.
 *
 * Hoy conviven dos nociones de mesero: el rol `WAITER` de `users` y la tabla `waiters`.
 * `waiters.user_id` existe, es opcional y nada lo exige ni lo valida, así que un mesero que
 * entra con su cuenta no queda atribuido en sus ventas y la misma persona puede tener dos
 * fichas en la misma sucursal. El índice de abajo cierra la segunda mitad; la primera —una
 * sola vía de atribución— se cierra en la creación de la venta.
 *
 * Y `enable_waiter_shifts` era un interruptor sin nada detrás: no había apertura, ni cierre,
 * ni rango de mesas, ni corte. Un turno de mesero no es el turno de caja: en un restaurante
 * la caja abre una vez y los meseros entran y salen dentro de ella, y la propina se liquida
 * por quien la trabajó, no por quien cerró el cajón.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  /**
   * Una persona, una ficha por sucursal.
   *
   * Es por sucursal y no por comercio a propósito: alguien puede trabajar en dos locales, y
   * cada local lleva su propia plantilla. Lo que no puede haber son dos fichas de la misma
   * persona en el mismo sitio, que es la duplicación que rompe la atribución.
   */
  await sql`
    CREATE UNIQUE INDEX uq_waiters_user_per_branch
    ON waiters (tenant_id, branch_id, user_id)
    WHERE user_id IS NOT NULL
  `.execute(db);

  await db.schema
    .createTable('waiter_shifts')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('branch_id', 'uuid', (col) => col.notNull().references('branches.id').onDelete('cascade'))
    .addColumn('waiter_id', 'uuid', (col) => col.notNull().references('waiters.id').onDelete('cascade'))
    /**
     * El turno de caja en el que ocurre. Nulo si el mesero entra antes de que la caja abra:
     * no se le puede impedir empezar a atender porque el cajero llegó tarde.
     */
    .addColumn('cash_session_id', 'uuid', (col) => col.references('cash_sessions.id').onDelete('set null'))
    .addColumn('opened_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('closed_at', 'timestamp')
    .addColumn('opened_by_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('closed_by_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    /** Congelado al cerrar: reabrir el corte de un turno viejo devuelve lo que dijo. */
    .addColumn('summary_json', 'jsonb')
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  /**
   * Un solo turno abierto por mesero.
   *
   * Sin esto, dos aperturas seguidas —el PIN tecleado dos veces, la pantalla que no
   * respondió— dejan dos turnos vivos y el corte cuenta las ventas dos veces. La atribución
   * por rango de tiempo que usa el corte depende de que los turnos de un mesero no se
   * solapen, y esta es la garantía de que no lo hacen.
   */
  await sql`
    CREATE UNIQUE INDEX uq_waiter_shifts_open
    ON waiter_shifts (tenant_id, waiter_id)
    WHERE closed_at IS NULL
  `.execute(db);

  await db.schema
    .createIndex('idx_waiter_shifts_branch')
    .on('waiter_shifts')
    .columns(['tenant_id', 'branch_id', 'opened_at'])
    .execute();

  /** El rango de mesas del turno: qué le tocó atender. */
  await db.schema
    .createTable('waiter_shift_tables')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('shift_id', 'uuid', (col) => col.notNull().references('waiter_shifts.id').onDelete('cascade'))
    .addColumn('table_id', 'uuid', (col) => col.notNull().references('tables.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_waiter_shift_tables ON waiter_shift_tables (shift_id, table_id)
  `.execute(db);

  for (const table of ['waiter_shifts', 'waiter_shift_tables']) {
    await sql`ALTER TABLE ${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.raw(table)}
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
    `.execute(db);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('waiter_shift_tables').execute();
  await db.schema.dropTable('waiter_shifts').execute();
  await sql`DROP INDEX IF EXISTS uq_waiters_user_per_branch`.execute(db);
}
