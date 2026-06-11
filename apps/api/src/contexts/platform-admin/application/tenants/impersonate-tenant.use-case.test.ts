import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImpersonateTenantUseCase } from './impersonate-tenant.use-case.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

vi.mock('crypto', () => ({
  randomUUID: () => 'mocked-uuid'
}));

vi.mock('../../../../shared/domain/audit/write-audit-log.js', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined)
}));

describe('ImpersonateTenantUseCase', () => {
  let dbMock: any;
  let useCase: ImpersonateTenantUseCase;

  beforeEach(() => {
    dbMock = {
      selectFrom: vi.fn(),
      insertInto: vi.fn()
    };
    useCase = new ImpersonateTenantUseCase(dbMock);
  });

  it('throws AppError if tenant does not exist', async () => {
    dbMock.selectFrom.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(null)
    });

    await expect(useCase.execute('tenant-1', 'reason', 'actor-1')).rejects.toThrow(
      new AppError(404, 'NOT_FOUND', 'Tenant no encontrado')
    );
  });

  it('throws AppError if no active owner found', async () => {
    // tenant mock
    const tenantMock = { id: 'tenant-1', owner_user_id: null };
    
    // First selectFrom for tenant
    const executeTakeFirstTenant = vi.fn().mockResolvedValue(tenantMock);
    
    // Third selectFrom for active owner in tenant
    const executeTakeFirstOwner2 = vi.fn().mockResolvedValue(null);

    dbMock.selectFrom.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          executeTakeFirst: executeTakeFirstTenant
        };
      }
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          executeTakeFirst: executeTakeFirstOwner2
        };
      }
    });

    await expect(useCase.execute('tenant-1', 'reason', 'actor-1')).rejects.toThrow(
      new AppError(400, 'BAD_REQUEST', 'El tenant no tiene usuarios activos a quienes suplantar')
    );
  });

  it('creates impersonation session and returns session id', async () => {
    const tenantMock = { id: 'tenant-1', owner_user_id: 'owner-1' };
    const ownerMock = { id: 'owner-1', active: true };

    const executeTakeFirstTenant = vi.fn().mockResolvedValue(tenantMock);
    const executeTakeFirstOwner = vi.fn().mockResolvedValue(ownerMock);

    dbMock.selectFrom.mockImplementation((table: string) => {
      if (table === 'tenants') {
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          executeTakeFirst: executeTakeFirstTenant
        };
      }
      if (table === 'users') {
        return {
          where: vi.fn().mockReturnThis(),
          selectAll: vi.fn().mockReturnThis(),
          executeTakeFirst: executeTakeFirstOwner
        };
      }
    });

    const executeInsert = vi.fn().mockResolvedValue({} as any);
    dbMock.insertInto.mockReturnValue({
      values: vi.fn().mockReturnValue({
        execute: executeInsert
      })
    });

    const result = await useCase.execute('tenant-1', 'Support ticket', 'actor-1');

    expect(result).toBe('mocked-uuid');
    expect(executeInsert).toHaveBeenCalled();
  });
});
