import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { TenantModulesState } from './tenant-module-dependency-resolver.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';

export class TenantModuleValidator {
  constructor(private readonly db: Kysely<Database>) {}

  public async validateDeactivations(
    tenantId: string,
    currentState: TenantModulesState,
    newState: TenantModulesState
  ): Promise<void> {
    const errors: string[] = [];

    // Check if enable_tables is being deactivated
    if (currentState.enable_tables && !newState.enable_tables) {
      const openOrders = await this.db
        .selectFrom('table_orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'OPEN')
        .limit(1)
        .execute();

      if (openOrders.length > 0) {
        errors.push('No se puede desactivar Mesas y Salones mientras haya órdenes de mesa activas.');
      }
    }

    // Check if enable_waiters is being deactivated
    if (currentState.enable_waiters && !newState.enable_waiters) {
      const openOrdersWithWaiters = await this.db
        .selectFrom('table_orders')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'OPEN')
        .where('waiter_id', 'is not', null)
        .limit(1)
        .execute();

      if (openOrdersWithWaiters.length > 0) {
        errors.push('No se puede desactivar Meseros mientras haya órdenes activas asignadas a un mesero.');
      }
    }

    // Check if enable_kitchen is being deactivated
    if (currentState.enable_kitchen && !newState.enable_kitchen) {
      const activeTickets = await this.db
        .selectFrom('kitchen_tickets')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['PENDING', 'PREPARING'])
        .limit(1)
        .execute();

      if (activeTickets.length > 0) {
        errors.push('No se puede desactivar Cocina mientras haya tickets de cocina activos o en preparación.');
      }
    }

    if (errors.length > 0) {
      throw new AppError(409, 'MODULE_DEACTIVATION_CONFLICT', 'No se pueden desactivar los módulos: ' + errors.join(' '));
    }
  }
}
