import { Kysely, sql } from 'kysely';

/**
 * El tiquete deja de depender del catálogo para saber qué se vendió.
 *
 * `sale_items` guardaba el `product_id` y el precio, pero no el nombre. El nombre se
 * resolvía con un join contra `products` **en el momento de mirar la venta**, así que
 * renombrar un producto reescribía el nombre impreso en el tiquete de una venta de hace
 * seis meses. Para un documento con obligación fiscal eso no debería poder pasar: lo que se
 * vendió se describió de una manera concreta el día que se vendió, y esa descripción es
 * parte del documento, no una consulta que se rehace cada vez.
 *
 * El importe ya estaba congelado (`price_cents`, `line_total_cents`). Esto termina el
 * trabajo: congela también la descripción.
 *
 * **Las ventas ya guardadas se quedan en NULL, a propósito.** El nombre que tenían el día
 * de la venta no se puede reconstruir —si el producto se renombró, se perdió— y rellenar con
 * el nombre de hoy sería estampar una afirmación falsa en un documento fiscal, con el
 * agravante de que después nadie podría distinguir cuál es de fiar. Un NULL dice la verdad:
 * «esto no se congeló». El lector hace el join para esas filas, como hasta ahora, y la
 * deuda se apaga sola según entren ventas nuevas.
 *
 * Por eso la columna es NULL-able y no tiene valor por defecto: cualquiera de las dos cosas
 * borraría la diferencia entre «se congeló» y «se reconstruyó».
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('sale_items')
    .addColumn('product_name', 'varchar(255)')
    .execute();

  await sql`
    COMMENT ON COLUMN sale_items.product_name IS
    'Nombre del producto congelado en el momento de la venta. NULL en ventas anteriores a la migración 111, donde no se puede reconstruir: para esas se resuelve con join contra products.'
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('sale_items').dropColumn('product_name').execute();
}
