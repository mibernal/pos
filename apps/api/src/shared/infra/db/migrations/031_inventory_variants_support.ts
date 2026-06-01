import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Añadir variant_id a todas las tablas de items y transacciones
  const tablesWithVariants = [
    'inventory_transactions',
    'inventory_adjustment_items',
    'inventory_transfer_items',
    'inventory_receipt_items',
    'purchase_order_items'
  ];

  for (const table of tablesWithVariants) {
    await sql`
      ALTER TABLE ${sql.table(table)}
      ADD COLUMN variant_id UUID NULL REFERENCES product_variants(id) ON DELETE RESTRICT
    `.execute(db);
  }

  // 2. Modificar inventory_balances para que soporte variant_id y crear un nuevo índice único
  
  // Añadimos variant_id
  await sql`
    ALTER TABLE inventory_balances
    ADD COLUMN variant_id UUID NULL REFERENCES product_variants(id) ON DELETE RESTRICT
  `.execute(db);

  // Quitamos la llave primaria compuesta actual (tenant_id, branch_id, product_id)
  await sql`
    ALTER TABLE inventory_balances
    DROP CONSTRAINT inventory_balances_pkey
  `.execute(db);

  // Añadimos una columna ID autogenerada como la verdadera llave primaria
  await sql`
    ALTER TABLE inventory_balances
    ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  `.execute(db);

  // Creamos un índice único que considera variant_id como NULL-safe usando coalesce
  // Esto asegura que no hayan dos registros para el mismo producto sin variante, 
  // o para el mismo producto con la misma variante.
  await sql`
    CREATE UNIQUE INDEX uq_inv_balances_tenant_branch_prod_var 
    ON inventory_balances (
      tenant_id, 
      branch_id, 
      product_id, 
      coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Rollback inventory_balances
  await sql`DROP INDEX IF EXISTS uq_inv_balances_tenant_branch_prod_var`.execute(db);
  
  await sql`ALTER TABLE inventory_balances DROP COLUMN IF EXISTS id`.execute(db);
  
  // Restaurar la primary key antigua
  // (Ojo: si durante este tiempo se crearon duplicados por product_id y distinto variant_id, esto fallará)
  await sql`
    ALTER TABLE inventory_balances
    ADD PRIMARY KEY (tenant_id, branch_id, product_id)
  `.execute(db);

  await sql`ALTER TABLE inventory_balances DROP COLUMN IF EXISTS variant_id`.execute(db);

  // Rollback otras tablas
  const tablesWithVariants = [
    'inventory_transactions',
    'inventory_adjustment_items',
    'inventory_transfer_items',
    'inventory_receipt_items',
    'purchase_order_items'
  ];

  for (const table of tablesWithVariants) {
    await sql`
      ALTER TABLE ${sql.table(table)}
      DROP COLUMN IF EXISTS variant_id
    `.execute(db);
  }
}
