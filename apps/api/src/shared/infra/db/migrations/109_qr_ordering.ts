import { Kysely, sql } from 'kysely';

/**
 * Migración 109 — Pedido desde el menú QR.
 *
 * El menú público existía y solo servía para mirar. Para que el comensal pueda pedir hacen
 * falta tres cosas.
 *
 * La primera es un identificador de mesa que no se pueda adivinar. El catálogo público hoy
 * se pide con el UUID de la sucursal, y para *leer* una carta eso da igual; para *escribir*
 * en la cocina no: con el id de la mesa a la vista, cualquiera manda comandas a un
 * restaurante desde su casa. El token es aleatorio, va impreso en el QR y se puede rotar sin
 * tocar la mesa —una mesa cuyo QR acabó fotografiado en internet se arregla imprimiendo otro
 * papel—.
 *
 * La segunda es saber de dónde vino cada plato. Un pedido que entró por el móvil del cliente
 * y uno que tomó el mesero no se atienden igual, y cuando algo sale mal la primera pregunta
 * del encargado es quién lo pidió.
 *
 * La tercera es «la cuenta, por favor»: hoy el comensal tiene que levantar la mano.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('tables').addColumn('qr_token', 'varchar(64)').execute();

  /**
   * Único en todo el sistema, no por comercio: el token es lo único que trae la petición
   * pública, así que es él quien tiene que resolver a un comercio sin ambigüedad.
   */
  await sql`
    CREATE UNIQUE INDEX uq_tables_qr_token ON tables (qr_token) WHERE qr_token IS NOT NULL
  `.execute(db);

  await db.schema
    .alterTable('table_order_items')
    .addColumn('source', 'varchar(20)', (col) => col.notNull().defaultTo('POS'))
    .execute();

  await db.schema.alterTable('table_orders').addColumn('bill_requested_at', 'timestamp').execute();

  await sql`
    COMMENT ON COLUMN table_order_items.source IS 'POS · QR — quién metió el plato en la cuenta'
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS uq_tables_qr_token`.execute(db);
  await db.schema.alterTable('tables').dropColumn('qr_token').execute();
  await db.schema.alterTable('table_order_items').dropColumn('source').execute();
  await db.schema.alterTable('table_orders').dropColumn('bill_requested_at').execute();
}
