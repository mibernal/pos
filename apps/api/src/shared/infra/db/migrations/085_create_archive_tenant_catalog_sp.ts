import { sql, Kysely } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  // Creamos un Stored Procedure que recibe un tenant_id y aplica la limpieza solo a ese tenant
  await sql`
    CREATE OR REPLACE FUNCTION archive_tenant_catalog(target_tenant_id UUID)
    RETURNS void AS $$
    BEGIN
      -- 1. Eliminar datos operativos en vivo del tenant (Mesas, Comandas, Cocina)
      DELETE FROM kitchen_ticket_items WHERE tenant_id = target_tenant_id;
      DELETE FROM kitchen_tickets WHERE tenant_id = target_tenant_id;
      DELETE FROM order_rounds WHERE tenant_id = target_tenant_id;
      DELETE FROM table_order_items WHERE tenant_id = target_tenant_id;
      DELETE FROM table_orders WHERE tenant_id = target_tenant_id;
      
      UPDATE tables 
      SET status = 'AVAILABLE', current_order_id = NULL, waiter_id = NULL 
      WHERE tenant_id = target_tenant_id;

      -- 2. Eliminar transferencias y ajustes pendientes
      DELETE FROM inventory_transfer_items WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_transfers WHERE tenant_id = target_tenant_id;
      DELETE FROM purchase_order_items WHERE tenant_id = target_tenant_id;
      DELETE FROM purchase_orders WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_receipt_items WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_receipts WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_adjustment_items WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_adjustments WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_count_items WHERE tenant_id = target_tenant_id;
      DELETE FROM inventory_counts WHERE tenant_id = target_tenant_id;

      -- 3. Limpiar stock actual absoluto
      DELETE FROM inventory_balances WHERE tenant_id = target_tenant_id;

      -- 4. Borrar entidades dependientes
      DELETE FROM product_images WHERE tenant_id = target_tenant_id;
      DELETE FROM promotions WHERE tenant_id = target_tenant_id;

      -- 5. Archivar Variantes y Productos Lógicamente
      UPDATE product_variants 
      SET 
        active = false, 
        name = '[ARCHIVADO] ' || name, 
        barcode = NULL, 
        updated_at = NOW()
      WHERE tenant_id = target_tenant_id 
        AND (active = true OR name NOT LIKE '[ARCHIVADO]%');

      UPDATE products 
      SET 
        active = false, 
        name = '[ARCHIVADO] ' || name, 
        barcode = NULL, 
        updated_at = NOW()
      WHERE tenant_id = target_tenant_id 
        AND (active = true OR name NOT LIKE '[ARCHIVADO]%');
        
    END;
    $$ LANGUAGE plpgsql;
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS archive_tenant_catalog(UUID)`.execute(db);
}
