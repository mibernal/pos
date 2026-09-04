import { Kysely, sql } from 'kysely';

/**
 * Migración 106 — Recetas y escandallo.
 *
 * El módulo de inventario es de lo mejor construido del sistema —balances, traslados,
 * conteos, kardex, valoración— y no le sirve de nada al vertical que el producto mejor
 * cubre: en un restaurante, vender un plato no baja ningún ingrediente. Baja el «plato»,
 * que es un producto que nadie compra ni almacena, mientras el aceite, la carne y el pan se
 * consumen sin que el sistema se entere.
 *
 * Con la receta, vender una hamburguesa descuenta pan, carne y queso; el costo del plato
 * deja de ser un número escrito a mano en `products.cost_cents` y pasa a calcularse; y la
 * diferencia entre lo que la receta dice que debió consumirse y lo que el conteo físico
 * encuentra se puede medir, que es la única forma de saber si se está yendo el aceite.
 *
 * Un ingrediente es un producto más: reutiliza los balances, el kardex y el costo que ya
 * existen. No hay una tabla de «ingredientes» aparte porque la carne que entra por una
 * recepción y la que sale por una receta son la misma carne.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('product_recipes')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('cascade'))
    /** Receta específica de una variante; nula si aplica al producto entero. */
    .addColumn('variant_id', 'uuid')
    /**
     * Cuántas unidades produce la receta.
     *
     * Una salsa madre se prepara por litros y se usa por cucharadas: sin rendimiento habría
     * que expresar cada componente en fracciones y el escandallo dejaría de ser legible.
     */
    .addColumn('yield_qty', 'numeric(12, 3)', (col) => col.notNull().defaultTo(1))
    .addColumn('active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('notes', 'varchar(300)')
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE product_recipes ADD CONSTRAINT ck_product_recipes_yield CHECK (yield_qty > 0)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_product_recipes_target
    ON product_recipes (tenant_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  `.execute(db);

  await db.schema
    .createTable('recipe_components')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) => col.notNull().references('tenants.id').onDelete('cascade'))
    .addColumn('recipe_id', 'uuid', (col) => col.notNull().references('product_recipes.id').onDelete('cascade'))
    .addColumn('ingredient_product_id', 'uuid', (col) => col.notNull().references('products.id').onDelete('restrict'))
    .addColumn('ingredient_variant_id', 'uuid')
    /** Cuánto consume la receta entera, no una unidad: se divide por el rendimiento. */
    .addColumn('qty', 'numeric(12, 4)', (col) => col.notNull())
    /**
     * Merma, en porcentaje. La cebolla que se pela pierde piel y la carne pierde agua: sin
     * merma el escandallo cuadra en el papel y nunca contra el conteo físico.
     */
    .addColumn('waste_percent', 'numeric(5, 2)', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    .execute();

  await sql`
    ALTER TABLE recipe_components
    ADD CONSTRAINT ck_recipe_components_qty CHECK (qty > 0 AND waste_percent >= 0 AND waste_percent < 100)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_recipe_components_ingredient
    ON recipe_components (recipe_id, ingredient_product_id, COALESCE(ingredient_variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  `.execute(db);

  await db.schema
    .createIndex('idx_recipe_components_ingredient')
    .on('recipe_components')
    .columns(['tenant_id', 'ingredient_product_id'])
    .execute();

  for (const table of ['product_recipes', 'recipe_components']) {
    await sql`ALTER TABLE ${sql.raw(table)} ENABLE ROW LEVEL SECURITY`.execute(db);
    await sql`ALTER TABLE ${sql.raw(table)} FORCE ROW LEVEL SECURITY`.execute(db);
    await sql`
      CREATE POLICY tenant_isolation_policy ON ${sql.raw(table)}
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid)
    `.execute(db);
  }

  /**
   * `RECIPE` como operación de inventario, distinta de `SALE`.
   *
   * Al mirar el kardex del pan hay que poder saber si bajó porque se vendió pan o porque se
   * vendieron hamburguesas. Sin esa distinción, la desviación contra el conteo físico no se
   * puede atribuir a nada: se ve que falta pan y no se sabe si falta de la vitrina o de la
   * cocina.
   *
   * Ambas columnas son enums, no texto libre, así que el valor hay que añadirlo al tipo. Es
   * el mismo patrón de la migración 022. `ADD VALUE` sí corre dentro de una transacción en
   * PostgreSQL 12+; lo que no se puede es usar el valor nuevo en esa misma transacción, y
   * aquí no se usa.
   */
  await sql`ALTER TYPE inventory_operation_enum ADD VALUE IF NOT EXISTS 'RECIPE'`.execute(db);
  await sql`ALTER TYPE inventory_ledger_operation ADD VALUE IF NOT EXISTS 'RECIPE_DISCHARGE'`.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('recipe_components').execute();
  await db.schema.dropTable('product_recipes').execute();
  // Los valores de enum no se quitan: PostgreSQL no lo permite y, aunque lo permitiera,
  // habría movimientos de kardex ya escritos con ellos. Un valor de más es inofensivo.
}
