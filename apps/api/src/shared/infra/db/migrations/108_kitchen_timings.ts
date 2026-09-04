import { Kysely, sql } from 'kysely';

/**
 * Migración 108 — Marcas de tiempo de cocina.
 *
 * Sin esto no se puede medir cuánto tarda la cocina. `kitchen_tickets` tenía `created_at` y
 * `updated_at`, y `updated_at` se pisa en cada transición: en un ticket que llegó a
 * DELIVERED mide el tiempo hasta la entrega, en uno que se quedó en PREPARING mide el tiempo
 * hasta que alguien lo tocó. Un informe construido sobre una columna que significa cosas
 * distintas según la fila no es un informe lento: es un informe que miente.
 *
 * Tres marcas que no se pisan. El tiempo de preparación es `ready_at − created_at`; lo que
 * pasa entre `ready_at` y `delivered_at` es plato terminado esperando a que alguien lo
 * lleve, que es un problema distinto y del comedor, no de la cocina.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('kitchen_tickets')
    .addColumn('started_at', 'timestamp')
    .addColumn('ready_at', 'timestamp')
    .addColumn('delivered_at', 'timestamp')
    .execute();

  /**
   * No se rellenan hacia atrás. Se podría poner `updated_at` en la marca que corresponda al
   * estado actual, pero eso inventaría un dato: de un ticket viejo no se sabe cuándo estuvo
   * listo, solo cuándo se tocó por última vez. El informe empieza a tener historia desde
   * aquí, y eso es preferible a arrancar con una media falsa.
   */

  await db.schema
    .createIndex('idx_kitchen_tickets_ready')
    .on('kitchen_tickets')
    .columns(['tenant_id', 'branch_id', 'created_at'])
    .execute();

  await sql`
    COMMENT ON COLUMN kitchen_tickets.ready_at IS
    'Cuándo la cocina lo dio por listo. El tiempo de preparación es ready_at - created_at.'
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('kitchen_tickets')
    .dropColumn('started_at')
    .dropColumn('ready_at')
    .dropColumn('delivered_at')
    .execute();
}
