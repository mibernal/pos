import { Kysely } from 'kysely';
import { Database } from '../../../../shared/infra/db/schema.js';
import { UpdateTenantModulesInput } from '@pos-dian/shared';
import { TenantModuleDependencyResolver, TenantModulesState } from '../../domain/tenant-module-dependency-resolver.js';
import { TenantModuleValidator } from '../../domain/tenant-module-validator.js';

export class UpdateTenantModulesUseCase {
  constructor(private readonly db: Kysely<Database>) {}

  public async execute(
    tenantId: string,
    payload: UpdateTenantModulesInput,
    performedByUserId: string
  ): Promise<void> {
    const tenant = await this.db
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', tenantId)
      .executeTakeFirst();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const currentState: TenantModulesState = {
      enable_tables: tenant.enable_tables,
      enable_delivery: tenant.enable_delivery,
      enable_waiters: tenant.enable_waiters,
      enable_split_bill: tenant.enable_split_bill,
      enable_tips: tenant.enable_tips,
      enable_kitchen: tenant.enable_kitchen,
      enable_kitchen_display: tenant.enable_kitchen_display,
      enable_kitchen_tickets: tenant.enable_kitchen_tickets,
      enable_kitchen_printing: tenant.enable_kitchen_printing,
      enable_order_rounds: tenant.enable_order_rounds,
      enable_product_modifiers: tenant.enable_product_modifiers,
      enable_reservations: tenant.enable_reservations,
      enable_waiter_shifts: tenant.enable_waiter_shifts,
      enable_qr_menu: tenant.enable_qr_menu,
      enable_guests_count: tenant.enable_guests_count,
      enable_restaurant: tenant.enable_restaurant ?? false,
      enable_kds: tenant.enable_kds ?? false,
      enable_inventory: tenant.enable_inventory ?? false,
      enable_fiscal: tenant.enable_fiscal ?? false,
      enable_loyalty: tenant.enable_loyalty ?? false,
      enable_advanced_reports: tenant.enable_advanced_reports ?? false
    };

    const { newState, auditLogs } = TenantModuleDependencyResolver.resolve(currentState, payload.modules);

    if (auditLogs.length === 0) {
      // Nothing changed
      return;
    }

    const validator = new TenantModuleValidator(this.db);
    await validator.validateDeactivations(tenantId, currentState, newState);

    await this.db.transaction().execute(async (trx) => {
      // Update tenant
      await trx
        .updateTable('tenants')
        .set(newState)
        .where('id', '=', tenantId)
        .execute();

      // Insert audit logs
      const auditLogRecords = auditLogs.map(log => ({
        tenant_id: tenantId,
        performed_by: performedByUserId,
        module_name: log.module_name,
        previous_state: log.previous_state,
        new_state: log.new_state,
        reason: payload.reason,
        is_cascade: log.is_cascade
      }));

      await trx
        .insertInto('tenant_module_audit_logs')
        .values(auditLogRecords)
        .execute();
    });
  }
}
