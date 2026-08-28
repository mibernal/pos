import { createAdminDb } from './connection.js';
import { sql } from 'kysely';

const db = createAdminDb();

async function main() {
  console.log('⚠️ INICIANDO BORRADO FÍSICO DE DATOS (TRUNCATE CASCADE)...');
  
  try {
    await sql`
      TRUNCATE TABLE 
        products, 
        product_variants, 
        product_images, 
        product_modifier_groups, 
        product_modifier_options, 
        promotions, 
        sales, 
        sale_items, 
        sale_returns, 
        return_items, 
        dian_documents, 
        cash_sessions, 
        cash_session_audits, 
        cash_movements, 
        cash_reconciliations, 
        table_orders, 
        table_order_items, 
        order_rounds, 
        kitchen_tickets, 
        kitchen_ticket_items, 
        reservations, 
        deliveries, 
        delivery_items, 
        inventory_balances, 
        inventory_transactions, 
        inventory_receipts, 
        inventory_receipt_items, 
        inventory_transfers, 
        inventory_transfer_items, 
        inventory_adjustments, 
        inventory_adjustment_items, 
        inventory_counts, 
        inventory_count_items, 
        purchase_orders, 
        purchase_order_items, 
        sales_ledger, 
        inventory_ledger, 
        cash_ledger
      CASCADE;
    `.execute(db);
    
    console.log('✅ BORRADO FÍSICO COMPLETADO CON ÉXITO.');
    console.log('Todas las bases de datos (catálogo y transacciones) han sido limpiadas.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error durante el borrado físico:', error);
    process.exit(1);
  }
}

main();
