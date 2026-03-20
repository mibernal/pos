import type { FastifyRequest } from 'fastify';

type RequestLike = Pick<FastifyRequest, 'id' | 'method' | 'url' | 'headers'> & {
  auth?: FastifyRequest['auth'];
  body?: unknown;
  query?: unknown;
  params?: unknown;
  routeOptions?: {
    url?: string;
  };
};

interface RequestLogContextOverrides {
  branchId?: string | null;
  saleId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(source: unknown, key: string): string | null {
  if (!isRecord(source)) {
    return null;
  }

  const candidate = source[key];
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
}

function readHeaderString(headers: RequestLike['headers'], key: string): string | null {
  const candidate = headers[key];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate;
  }

  if (Array.isArray(candidate) && typeof candidate[0] === 'string' && candidate[0].trim().length > 0) {
    return candidate[0];
  }

  return null;
}

function inferBranchId(request: RequestLike): string | null {
  return (
    readStringField(request.body, 'branch_id') ??
    readStringField(request.query, 'branch_id') ??
    readHeaderString(request.headers, 'x-branch-id')
  );
}

function inferSaleId(request: RequestLike): string | null {
  const routeUrl = request.routeOptions?.url ?? request.url;
  if (!routeUrl.includes('/sales/')) {
    return null;
  }

  return readStringField(request.params, 'id');
}

export function buildRequestLogContext(
  request: RequestLike,
  overrides: RequestLogContextOverrides = {}
) {
  return {
    tenant_id: request.auth?.tenantId ?? null,
    branch_id: overrides.branchId ?? inferBranchId(request) ?? null,
    user_id: request.auth?.userId ?? null,
    sale_id: overrides.saleId ?? inferSaleId(request) ?? null,
    method: request.method,
    url: request.url
  };
}
