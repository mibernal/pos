export const userKeys = {
  all: (tenantId: string | null | undefined) => ['tenant', tenantId, 'users'] as const,
  branches: (tenantId: string | null | undefined) => ['tenant', tenantId, 'branches'] as const,
};
