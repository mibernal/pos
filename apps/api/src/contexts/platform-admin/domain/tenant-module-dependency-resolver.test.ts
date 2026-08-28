import { describe, it, expect } from 'vitest';
import { TenantModuleDependencyResolver, TenantModulesState } from './tenant-module-dependency-resolver.js';

const getBaseState = (): TenantModulesState => ({
  enable_tables: false,
  enable_delivery: false,
  enable_waiters: false,
  enable_split_bill: false,
  enable_tips: false,
  enable_kitchen: false,
  enable_kitchen_display: false,
  enable_kitchen_tickets: false,
  enable_kitchen_printing: false,
  enable_order_rounds: false,
  enable_product_modifiers: false,
  enable_reservations: false,
  enable_waiter_shifts: false,
  enable_qr_menu: false,
  enable_guests_count: false,
  enable_restaurant: false,
  enable_kds: false,
  enable_inventory: false,
  enable_fiscal: false,
  enable_loyalty: false,
  enable_advanced_reports: false
});

describe('TenantModuleDependencyResolver', () => {
  it('should auto-activate enable_tables when enable_waiters is requested', () => {
    const currentState = getBaseState();
    const result = TenantModuleDependencyResolver.resolve(currentState, { enable_waiters: true });

    expect(result.newState.enable_waiters).toBe(true);
    expect(result.newState.enable_tables).toBe(true);
    
    // Check audit logs
    expect(result.auditLogs).toHaveLength(2);
    expect(result.auditLogs.find(l => l.module_name === 'enable_waiters')?.is_cascade).toBe(false);
    expect(result.auditLogs.find(l => l.module_name === 'enable_tables')?.is_cascade).toBe(true);
  });

  it('should auto-deactivate children when enable_tables is turned off', () => {
    const currentState = getBaseState();
    currentState.enable_tables = true;
    currentState.enable_waiters = true;
    currentState.enable_waiter_shifts = true;
    currentState.enable_reservations = true;

    const result = TenantModuleDependencyResolver.resolve(currentState, { enable_tables: false });

    expect(result.newState.enable_tables).toBe(false);
    expect(result.newState.enable_waiters).toBe(false);
    expect(result.newState.enable_waiter_shifts).toBe(false);
    expect(result.newState.enable_reservations).toBe(false);

    expect(result.auditLogs.length).toBe(4);
    expect(result.auditLogs.find(l => l.module_name === 'enable_tables')?.is_cascade).toBe(false);
    expect(result.auditLogs.find(l => l.module_name === 'enable_waiters')?.is_cascade).toBe(true);
  });

  it('should handle complex kitchen upwards cascade', () => {
    const currentState = getBaseState();
    const result = TenantModuleDependencyResolver.resolve(currentState, { enable_kitchen_printing: true });

    expect(result.newState.enable_kitchen_printing).toBe(true);
    expect(result.newState.enable_kitchen_tickets).toBe(true);
    expect(result.newState.enable_kitchen).toBe(true);
    
    expect(result.auditLogs).toHaveLength(3);
    expect(result.auditLogs.filter(l => l.is_cascade)).toHaveLength(2);
  });

  it('should handle kitchen downwards cascade', () => {
    const currentState = getBaseState();
    currentState.enable_kitchen = true;
    currentState.enable_kitchen_display = true;
    currentState.enable_kitchen_tickets = true;
    currentState.enable_kitchen_printing = true;
    currentState.enable_order_rounds = true;

    const result = TenantModuleDependencyResolver.resolve(currentState, { enable_kitchen: false });

    expect(result.newState.enable_kitchen).toBe(false);
    expect(result.newState.enable_kitchen_display).toBe(false);
    expect(result.newState.enable_kitchen_tickets).toBe(false);
    expect(result.newState.enable_kitchen_printing).toBe(false);
    expect(result.newState.enable_order_rounds).toBe(false);

    expect(result.auditLogs).toHaveLength(5);
  });
});
