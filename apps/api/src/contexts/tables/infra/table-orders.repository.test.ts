import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TableOrdersRepository } from './table-orders.repository.js';
describe('TableOrdersRepository - sendTableOrderToKitchen', () => {
  let repository: TableOrdersRepository;
  let mockDb: any;

  beforeEach(() => {
    // Mock the Kysely DB transaction logic
    mockDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async (callback) => {
          return callback({
            selectFrom: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            selectAll: vi.fn().mockReturnThis(),
            executeTakeFirst: vi.fn().mockResolvedValue({ id: 'order-1', status: 'OPEN' }),
            execute: vi.fn().mockResolvedValue([
              { id: 'item-1', product_id: 'prod-1', qty: 2, sent_to_kitchen_at: null, notes: 'Sin cebolla' }
            ]),
            updateTable: vi.fn().mockReturnThis(),
            set: vi.fn().mockReturnThis(),
          });
        }),
      }),
    };
    repository = new TableOrdersRepository(mockDb as any);
  });

  it('should calculate unprinted items and mark them as sent to kitchen', async () => {
    const result = await repository.sendTableOrderToKitchen('tenant-1', 'branch-1', 'table-1');
    
    expect(result.order).toBeDefined();
    expect(result.itemsSent).toHaveLength(1);
    expect(result.itemsSent[0]!.id).toBe('item-1');
    expect(result.itemsSent[0]!.qty).toBe(2);
    expect(result.itemsSent[0]!.notes).toBe('Sin cebolla');
  });
});
