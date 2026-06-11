import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReactivateTenantUseCase } from './reactivate-tenant.use-case.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

vi.mock('../../../../shared/domain/audit/write-audit-log.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined)
}));

describe('ReactivateTenantUseCase', () => {
  let dbMock: any;
  let useCase: ReactivateTenantUseCase;

  beforeEach(() => {
    dbMock = {
      selectFrom: vi.fn(),
      updateTable: vi.fn(),
      insertInto: vi.fn()
    };
    useCase = new ReactivateTenantUseCase(dbMock);
  });

  it('throws AppError if tenant does not exist', async () => {
    dbMock.selectFrom.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    });

    await expect(useCase.execute('tenant-1', 'actor-1', 'actor@admin.com')).rejects.toThrow(
      new AppError(404, 'NOT_FOUND', 'Tenant no encontrado')
    );
  });

  it('reactivates tenant and logs event', async () => {
    const tenantMock = { id: 'tenant-1' };
    
    dbMock.selectFrom.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(tenantMock)
    });

    const executeUpdate = vi.fn().mockResolvedValue(undefined);
    dbMock.updateTable.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: executeUpdate
    });

    const executeInsert = vi.fn().mockResolvedValue(undefined);
    dbMock.insertInto.mockReturnValue({
      values: vi.fn().mockReturnValue({
        execute: executeInsert
      })
    });

    await useCase.execute('tenant-1', 'actor-1', 'admin@pos.com');

    expect(executeUpdate).toHaveBeenCalled();
    expect(executeInsert).toHaveBeenCalled();
  });
});
