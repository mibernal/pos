export type TenantModulesState = {
  enable_tables: boolean;
  enable_delivery: boolean;
  enable_waiters: boolean;
  enable_split_bill: boolean;
  enable_tips: boolean;
  enable_kitchen: boolean;
  enable_kitchen_display: boolean;
  enable_kitchen_tickets: boolean;
  enable_kitchen_printing: boolean;
  enable_order_rounds: boolean;
  enable_product_modifiers: boolean;
  enable_reservations: boolean;
  enable_waiter_shifts: boolean;
  enable_qr_menu: boolean;
  enable_guests_count: boolean;
  enable_restaurant: boolean;
  enable_kds: boolean;
  enable_inventory: boolean;
  enable_fiscal: boolean;
  enable_loyalty: boolean;
  enable_advanced_reports: boolean;
};

export type AuditLogEntry = {
  module_name: keyof TenantModulesState;
  previous_state: boolean;
  new_state: boolean;
  is_cascade: boolean;
};

export class TenantModuleDependencyResolver {
  public static resolve(
    currentState: TenantModulesState,
    requestedChanges: Partial<TenantModulesState>
  ): { newState: TenantModulesState; auditLogs: AuditLogEntry[] } {
    const newState = { ...currentState };
    const auditLogs: AuditLogEntry[] = [];

    // Track explicit changes to separate them from cascade changes
    const explicitChanges = new Set<keyof TenantModulesState>();

    for (const key of Object.keys(requestedChanges) as Array<keyof TenantModulesState>) {
      if (requestedChanges[key] !== undefined && requestedChanges[key] !== currentState[key]) {
        newState[key] = requestedChanges[key] as boolean;
        explicitChanges.add(key);
      }
    }

    let hasChanges = true;
    while (hasChanges) {
      hasChanges = false;

      const checkDependency = (child: keyof TenantModulesState, parent: keyof TenantModulesState) => {
        if (newState[child] === true && newState[parent] === false) {
          if (explicitChanges.has(parent) && !explicitChanges.has(child)) {
            // User explicitly turned off the parent. Cascade disable the child.
            newState[child] = false;
            hasChanges = true;
          } else {
            // User explicitly turned on the child, or both/neither. Cascade enable the parent.
            newState[parent] = true;
            hasChanges = true;
          }
        }
      };

      checkDependency('enable_waiter_shifts', 'enable_waiters');
      checkDependency('enable_waiters', 'enable_tables');
      checkDependency('enable_reservations', 'enable_tables');
      checkDependency('enable_split_bill', 'enable_tables');
      checkDependency('enable_kitchen_printing', 'enable_kitchen_tickets');
      checkDependency('enable_kitchen_tickets', 'enable_kitchen');
      checkDependency('enable_kitchen_display', 'enable_kitchen');

      // order_rounds requires either tables or kitchen
      if (newState.enable_order_rounds && !newState.enable_tables && !newState.enable_kitchen) {
        if (explicitChanges.has('enable_tables') || explicitChanges.has('enable_kitchen')) {
          newState.enable_order_rounds = false;
        } else {
          newState.enable_tables = true; // Fallback
        }
        hasChanges = true;
      }
    }

    // Generate Audit Logs
    for (const key of Object.keys(newState) as Array<keyof TenantModulesState>) {
      if (newState[key] !== currentState[key]) {
        auditLogs.push({
          module_name: key,
          previous_state: currentState[key],
          new_state: newState[key],
          is_cascade: !explicitChanges.has(key)
        });
      }
    }

    return { newState, auditLogs };
  }
}
