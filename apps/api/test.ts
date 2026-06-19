import { createDb } from './src/shared/infra/db/connection.js';

async function main() {
  const db = createDb();
  try {
    const tenantId = '11111111-3333-4333-8333-333333333333';
    const branchId = '22222222-3333-4222-8222-333333333333';

    console.log("Fetching rooms...");
    const rooms = await db.selectFrom('rooms')
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
      
    console.log("Rooms:", rooms);

    console.log("Fetching tables...");
    const tables = await db.selectFrom('tables')
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .selectAll()
      .orderBy('name', 'asc')
      .execute();

    console.log("Tables:", tables);
    
    console.log("Fetching table orders...");
    const tableIdsWithOrders = tables.filter(t => t.current_order_id).map(t => t.id);
    if (tableIdsWithOrders.length > 0) {
      const activeOrders = await db.selectFrom('tables as t')
        .innerJoin('table_orders as o', 'o.id', 't.current_order_id')
        .where('t.id', 'in', tableIdsWithOrders)
        .where('t.tenant_id', '=', tenantId)
        .select(['t.id as tableId', 'o.total_cents'])
        .execute();
      console.log("Active orders:", activeOrders);
    }
    
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await db.destroy();
  }
}

main();
