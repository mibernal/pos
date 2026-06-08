export const inventoryKeys = {
  products: (tenantId: string | null | undefined, branchId?: string | null | undefined) => 
    ['tenant', tenantId, 'products', ...(branchId ? [branchId] : [])] as const,
  balances: (tenantId: string | null | undefined, branchId?: string | null | undefined) => 
    ['tenant', tenantId, 'balances', ...(branchId ? [branchId] : [])] as const,
  consolidatedInventory: (tenantId: string | null | undefined) => 
    ['tenant', tenantId, 'consolidatedInventory'] as const,
  expectedReconciliation: (tenantId: string | null | undefined, entityId: string, entityType: string) => 
    ['tenant', tenantId, 'expected', entityId, entityType] as const,
};
