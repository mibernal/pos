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

    // Un módulo apagado en cascada debe comportarse, frente a SUS hijos, igual que uno
    // apagado a mano. Sin esto, apagar `enable_kitchen` con la impresión encendida hacía
    // que `enable_kitchen_tickets` oscilara entre apagado (por su padre) y encendido (por
    // su hijo) en cada vuelta: un bucle infinito SÍNCRONO que bloquea el event loop y deja
    // toda la API sin responder.
    const disabledByCascade = new Set<keyof TenantModulesState>();

    // Red de seguridad: el grafo de dependencias es pequeño y converge en pocas vueltas.
    // Si una regla futura vuelve a introducir un ciclo, preferimos un estado coherente y
    // un error explícito antes que colgar el proceso.
    const MAX_PASSES = 32;
    let passes = 0;

    let hasChanges = true;
    while (hasChanges) {
      if (passes++ >= MAX_PASSES) {
        throw new Error(
          'TenantModuleDependencyResolver: las dependencias de módulos no convergen. Revisa las reglas en cascada.'
        );
      }
      hasChanges = false;

      const checkDependency = (child: keyof TenantModulesState, parent: keyof TenantModulesState) => {
        if (newState[child] === true && newState[parent] === false) {
          const parentWasTurnedOff = explicitChanges.has(parent) || disabledByCascade.has(parent);
          if (parentWasTurnedOff && !explicitChanges.has(child)) {
            // El padre se apagó (a mano o en cascada): el hijo lo sigue.
            newState[child] = false;
            disabledByCascade.add(child);
            hasChanges = true;
          } else {
            // El usuario encendió el hijo explícitamente: se enciende el padre.
            newState[parent] = true;
            disabledByCascade.delete(parent);
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
        if (
          explicitChanges.has('enable_tables') ||
          explicitChanges.has('enable_kitchen') ||
          disabledByCascade.has('enable_tables') ||
          disabledByCascade.has('enable_kitchen')
        ) {
          newState.enable_order_rounds = false;
          disabledByCascade.add('enable_order_rounds');
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
