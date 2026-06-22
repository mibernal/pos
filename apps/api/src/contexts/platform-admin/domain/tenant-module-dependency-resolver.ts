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

      // Upward Cascading (Auto-Activación de Padres)
      if (newState.enable_waiter_shifts && !newState.enable_waiters) {
        newState.enable_waiters = true;
        hasChanges = true;
      }
      if (newState.enable_waiters && !newState.enable_tables) {
        newState.enable_tables = true;
        hasChanges = true;
      }
      if (newState.enable_kitchen_printing && !newState.enable_kitchen_tickets) {
        newState.enable_kitchen_tickets = true;
        hasChanges = true;
      }
      if (newState.enable_kitchen_tickets && !newState.enable_kitchen) {
        newState.enable_kitchen = true;
        hasChanges = true;
      }
      if (newState.enable_kitchen_display && !newState.enable_kitchen) {
        newState.enable_kitchen = true;
        hasChanges = true;
      }

      // Downward Cascading (Auto-Desactivación de Hijos)
      if (!newState.enable_tables) {
        const childrenToDisable: Array<keyof TenantModulesState> = [
          'enable_waiters',
          'enable_reservations',
          'enable_split_bill',
          'enable_order_rounds',
          'enable_waiter_shifts'
        ];
        for (const child of childrenToDisable) {
          if (newState[child]) {
            newState[child] = false;
            hasChanges = true;
          }
        }
      }

      if (!newState.enable_kitchen) {
        const childrenToDisable: Array<keyof TenantModulesState> = [
          'enable_kitchen_display',
          'enable_kitchen_tickets',
          'enable_order_rounds',
          'enable_kitchen_printing'
        ];
        for (const child of childrenToDisable) {
          if (newState[child]) {
            newState[child] = false;
            hasChanges = true;
          }
        }
      }

      if (!newState.enable_waiters && newState.enable_waiter_shifts) {
        newState.enable_waiter_shifts = false;
        hasChanges = true;
      }

      if (!newState.enable_kitchen_tickets && newState.enable_kitchen_printing) {
        newState.enable_kitchen_printing = false;
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
