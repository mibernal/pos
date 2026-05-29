import { describe, expect, it } from 'vitest';
import {
  buildSearchPattern,
  canAccessProductInBranchScope,
  resolveBranchIdForCreate,
  resolveBranchIdForPatch
} from '../src/contexts/inventory/services/products/scope.js';
import { AppError } from '../src/shared/infra/errors/app-error.js';
import { productsQuerySchema } from '../src/contexts/inventory/services/products/schemas.js';

describe('products scope helpers', () => {
  it('uses payload branch on create when header is not set', () => {
    const branchId = resolveBranchIdForCreate(undefined, '22222222-2222-4222-8222-222222222222');
    expect(branchId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('throws mismatch when header and payload branch differ', () => {
    expect(() =>
      resolveBranchIdForCreate(
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333'
      )
    ).toThrow(AppError);
  });

  it('keeps current branch on patch when payload branch is absent', () => {
    const branchId = resolveBranchIdForPatch(
      '22222222-2222-4222-8222-222222222222',
      undefined,
      null
    );
    expect(branchId).toBeNull();
  });

  it('allows global products for a branch scoped request', () => {
    expect(canAccessProductInBranchScope(null, '22222222-2222-4222-8222-222222222222')).toBe(true);
  });

  it('builds SQL ilike search pattern', () => {
    expect(buildSearchPattern('coca')).toBe('%coca%');
  });

  it('treats empty query as undefined', () => {
    const parsed = productsQuerySchema.parse({ query: '', limit: '10' });
    expect(parsed.query).toBeUndefined();
  });
});
