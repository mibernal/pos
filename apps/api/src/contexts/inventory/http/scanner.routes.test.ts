import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { verifyApprovalPin } from '../../../shared/infra/security/verify-pin.js';
import { scannerRoutes } from './scanner.routes.js';
import * as securityPermissions from '../../../shared/infra/security/permissions.js';
import * as inventoryRoutes from './inventory.routes.js';

vi.mock('../../../shared/infra/security/verify-pin.js', () => ({
  verifyApprovalPin: vi.fn()
}));

vi.mock('../../../shared/infra/security/permissions.js', () => ({
  ensureUserCanAccessBranch: vi.fn()
}));

vi.mock('./inventory.routes.js', () => ({
  recordInventoryTransaction: vi.fn()
}));

describe('scanner.routes.ts', () => {
  let appMock: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the db transaction
    const mockTrx = {
      selectFrom: vi.fn().mockReturnThis(),
      selectAll: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue({
        id: 'count-1', status: 'DRAFT', branch_id: 'branch-1', name: 'Test'
      }),
      execute: vi.fn().mockResolvedValue([
        { product_id: 'p1', variant_id: 'v1', diff_qty: 5 } // discrepancy
      ]),
      insertInto: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      updateTable: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returningAll: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({})
    };

    appMock = {
      withTypeProvider: vi.fn().mockReturnValue({
        post: vi.fn((path, opts, handler) => {
          if (path === '/inventory/counts/:id/commit') {
            appMock.commitCountHandler = handler;
          }
        })
      }),
      requirePermissions: vi.fn(),
      db: {
        transaction: () => ({
          execute: async (cb: any) => cb(mockTrx)
        })
      }
    };

    scannerRoutes(appMock as any, {} as any);
  });

  it('should throw PIN_REQUIRED if discrepancy exists and no pin provided', async () => {
    const req = {
      params: { id: 'count-1' },
      body: { notes: 'test' },
      auth: { tenantId: 't1', userId: 'u1' }
    };

    await expect(appMock.commitCountHandler(req, {} as any)).rejects.toThrow('PIN_REQUIRED');
  });

  it('should throw INVALID_PIN if verifyApprovalPin returns null', async () => {
    vi.mocked(verifyApprovalPin).mockResolvedValue(null);

    const req = {
      params: { id: 'count-1' },
      body: { notes: 'test', discrepancy_approved_by_pin: 'wrong' },
      auth: { tenantId: 't1', userId: 'u1' }
    };

    await expect(appMock.commitCountHandler(req, {} as any)).rejects.toThrow('INVALID_PIN');
  });

  it('should process the commit if PIN is valid', async () => {
    vi.mocked(verifyApprovalPin).mockResolvedValue('approver-1');
    const mockReply = { code: vi.fn().mockReturnThis(), send: vi.fn() };

    const req = {
      params: { id: 'count-1' },
      body: { notes: 'test', discrepancy_approved_by_pin: '1234' },
      auth: { tenantId: 't1', userId: 'u1' }
    };

    await appMock.commitCountHandler(req, mockReply);
    expect(mockReply.send).toHaveBeenCalled();
  });
});
