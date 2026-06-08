export const platformKeys = {
  plans: () => ['platform', 'plans'] as const,
  tenantUsers: (tenantId?: string | null | undefined) => 
    ['platform', 'tenant-users', ...(tenantId ? [tenantId] : [])] as const,
};
