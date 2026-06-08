import { describe, expect, it } from 'vitest';
import { buildRequestLogContext } from '../src/shared/infra/logging/request-log-context.js';

describe('request log context', () => {
  it('extracts tenant, branch and sale ids from the request', () => {
    const context = buildRequestLogContext({
      id: 'req-1',
      method: 'POST',
      url: '/api/v1/sales/sale-1/void',
      routeOptions: {
        url: '/api/v1/sales/:id/void'
      },
      headers: {
        'x-branch-id': 'branch-header'
      },
      auth: {
        tenantId: 'tenant-1',
        userId: 'user-1',
        role: 'ADMIN',
    isPlatformRole: false,
        email: 'admin@example.com',
        name: 'Admin',
        tenant_id: 'tenant-1',
        user_id: 'user-1'
      },
      params: {
        id: 'sale-1'
      },
      body: {
        branch_id: 'branch-body'
      },
      query: {}
    } as never);

    expect(context).toEqual({
      tenant_id: 'tenant-1',
      branch_id: 'branch-body',
      user_id: 'user-1',
      sale_id: 'sale-1',
      method: 'POST',
      url: '/api/v1/sales/sale-1/void'
    });
  });

  it('allows explicit overrides for route-specific logs', () => {
    const context = buildRequestLogContext(
      {
        id: 'req-2',
        method: 'POST',
        url: '/api/v1/sales',
        headers: {},
        auth: null,
        params: {},
        body: {},
        query: {}
      } as never,
      {
        branchId: 'branch-override',
        saleId: 'sale-override'
      }
    );

    expect(context.branch_id).toBe('branch-override');
    expect(context.sale_id).toBe('sale-override');
  });
});
