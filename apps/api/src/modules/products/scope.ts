import { AppError } from '../../infra/errors/app-error.js';

export function normalizeBranchHeader(rawHeaderValue: string | undefined): string | undefined {
  if (!rawHeaderValue) {
    return undefined;
  }

  return rawHeaderValue.trim();
}

function assertBranchHeaderAndPayloadMatch(
  headerBranchId: string | undefined,
  payloadBranchId: string | null | undefined
): void {
  if (headerBranchId && payloadBranchId !== undefined && payloadBranchId !== headerBranchId) {
    throw new AppError(
      400,
      'BRANCH_SCOPE_MISMATCH',
      'X-Branch-Id y branchId del payload deben coincidir'
    );
  }
}

export function resolveBranchIdForCreate(
  headerBranchId: string | undefined,
  payloadBranchId: string | null | undefined
): string | null {
  assertBranchHeaderAndPayloadMatch(headerBranchId, payloadBranchId);

  if (payloadBranchId !== undefined) {
    return payloadBranchId;
  }

  if (headerBranchId) {
    return headerBranchId;
  }

  return null;
}

export function resolveBranchIdForPatch(
  headerBranchId: string | undefined,
  payloadBranchId: string | null | undefined,
  currentBranchId: string | null
): string | null {
  assertBranchHeaderAndPayloadMatch(headerBranchId, payloadBranchId);

  if (payloadBranchId !== undefined) {
    return payloadBranchId;
  }

  return currentBranchId;
}

export function canAccessProductInBranchScope(
  productBranchId: string | null,
  headerBranchId: string | undefined
): boolean {
  if (!headerBranchId) {
    return true;
  }

  return productBranchId === null || productBranchId === headerBranchId;
}

export function buildSearchPattern(rawQuery: string | undefined): string | undefined {
  if (!rawQuery) {
    return undefined;
  }

  return `%${rawQuery.trim()}%`;
}
