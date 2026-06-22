import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { KitchenTicketWithItems } from '@pos-dian/shared';

export class KdsRepository {
  constructor(private db: Kysely<Database>) {}

  async getActiveTickets(tenantId: string, branchId: string): Promise<KitchenTicketWithItems[]> {
    const tickets = await this.db
      .selectFrom('kitchen_tickets as kt')
      .innerJoin('table_orders as to', 'to.id', 'kt.table_order_id')
      .innerJoin('tables as t', 't.id', 'to.table_id')
      .select([
        'kt.id',
        'kt.tenant_id',
        'kt.branch_id',
        'kt.round_id',
        'kt.table_order_id',
        'kt.status',
        'kt.printed_at',
        'kt.created_at',
        'kt.updated_at',
        't.name as table_name'
      ])
      .where('kt.tenant_id', '=', tenantId)
      .where('kt.branch_id', '=', branchId)
      .where('kt.status', '!=', 'DELIVERED')
      .orderBy('kt.created_at', 'asc')
      .execute();

    if (tickets.length === 0) return [];

    const ticketIds = tickets.map(t => t.id);

    // Fetch items for these tickets
    const items = await this.db
      .selectFrom('kitchen_ticket_items as kti')
      .leftJoin('products as p', 'p.id', 'kti.product_id')
      .leftJoin('product_variants as v', 'v.id', 'kti.variant_id')
      .select([
        'kti.id',
        'kti.tenant_id',
        'kti.branch_id',
        'kti.table_order_id',
        'kti.kitchen_ticket_id',
        'kti.product_id',
        'kti.variant_id',
        'kti.qty',
        'kti.item_status',
        'kti.notes',
        'p.name as product_name',
        'v.name as variant_name'
      ])
      .where('kti.tenant_id', '=', tenantId)
      .where('kti.branch_id', '=', branchId)
      .where('kti.kitchen_ticket_id', 'in', ticketIds)
      .execute();

    return tickets.map(ticket => {
      // Validate status defensively
      const validStatuses = ['PENDING', 'PREPARING', 'READY', 'DELIVERED'];
      const status = validStatuses.includes(ticket.status as string) 
        ? ticket.status as any 
        : 'PENDING';

      return {
        id: ticket.id,
        tenant_id: ticket.tenant_id,
        branch_id: ticket.branch_id,
        round_id: ticket.round_id,
        table_order_id: ticket.table_order_id,
        status: status,
        printed_at: ticket.printed_at ? new Date(ticket.printed_at).toISOString() : undefined,
        created_at: ticket.created_at ? new Date(ticket.created_at).toISOString() : new Date().toISOString(),
        updated_at: ticket.updated_at ? new Date(ticket.updated_at).toISOString() : new Date().toISOString(),
        tableName: ticket.table_name,
        items: items
          .filter(item => item.kitchen_ticket_id === ticket.id)
          .map(item => ({
            id: item.id,
            tenant_id: item.tenant_id,
            branch_id: item.branch_id,
            table_order_id: item.table_order_id,
            round_id: ticket.round_id, // Inherit from ticket since kti doesn't have it
            product_id: item.product_id,
            variant_id: item.variant_id,
            qty: Number(item.qty) || 1,
            item_status: item.item_status,
            modifiers: null, // Modifiers not currently stored in KTI
            notes: item.notes,
            productName: item.product_name ?? undefined,
            variantName: item.variant_name ?? undefined
          }))
      };
    });
  }

  async updateTicketStatus(tenantId: string, ticketId: string, status: string): Promise<void> {
    await this.db
      .updateTable('kitchen_tickets')
      .set({ status, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', ticketId)
      .execute();
  }
}
