import { describe, it, expect, vi, beforeEach, type Mocked } from 'vitest';
import { UpdateTableStatusUseCase } from './update-table-status.use-case.js';
import { TablesRepository } from '../infra/tables.repository.js';
import { Table, UpdateTableStatusPayload } from '@pos-dian/shared';

describe('UpdateTableStatusUseCase', () => {
  let useCase: UpdateTableStatusUseCase;
  let mockTablesRepo: Mocked<TablesRepository>;

  beforeEach(() => {
    mockTablesRepo = {
      updateTableStatus: vi.fn(),
    } as unknown as Mocked<TablesRepository>;
    useCase = new UpdateTableStatusUseCase(mockTablesRepo);
  });

  it('should update table status successfully', async () => {
    // Arrange
    const tenantId = 'tenant-1';
    const branchId = 'branch-1';
    const tableId = 'table-1';
    const payload: UpdateTableStatusPayload = {
      status: 'OCCUPIED',
      currentOrderId: 'sale-1'
    };

    const mockResponse: Table = {
      id: tableId,
      tenantId,
      branchId,
      roomId: 'room-1',
      name: 'Mesa 1',
      capacity: 4,
      status: 'OCCUPIED',
      currentOrderId: 'sale-1',
      statusUpdatedAt: new Date().toISOString(),
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    mockTablesRepo.updateTableStatus.mockResolvedValue(mockResponse);

    // Act
    const result = await useCase.execute(tenantId, branchId, tableId, payload);

    // Assert
    expect(mockTablesRepo.updateTableStatus).toHaveBeenCalledWith(tenantId, branchId, tableId, payload);
    expect(result).toEqual(mockResponse);
    expect(result.status).toBe('OCCUPIED');
    expect(result.currentOrderId).toBe('sale-1');
  });
});
