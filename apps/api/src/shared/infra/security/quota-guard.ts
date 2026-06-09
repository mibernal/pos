import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { AppError } from '../errors/app-error.js';

interface PlanFeatures {
  users?: number;
  branches?: number;
  support_level?: string;
}

export class QuotaGuard {
  static async assertCanCreateUser(db: Kysely<Database>, tenantId: string): Promise<void> {
    // 1. Obtener la suscripción activa del tenant y su plan asociado
    const subscriptionInfo = await db.selectFrom('tenant_subscriptions')
      .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
      .select('billing_plans.features_json')
      .where('tenant_subscriptions.tenant_id', '=', tenantId)
      // Asumimos que la suscripción activa tiene status 'ACTIVE'
      .where('tenant_subscriptions.status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (!subscriptionInfo) {
      throw new AppError(403, 'QUOTA_EXCEEDED', 'No se encontró una suscripción activa para este tenant.');
    }

    const features = subscriptionInfo.features_json as PlanFeatures;
    const limit = features.users ?? -1;

    if (limit === -1) {
      return; // Ilimitado
    }

    // 2. Contar los usuarios activos del tenant
    const { count } = await db.selectFrom('users')
      .select(db.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId)
      .where('active', '=', true)
      .executeTakeFirstOrThrow();

    // 3. Validar cuota
    if (Number(count) >= limit) {
      throw new AppError(403, 'QUOTA_EXCEEDED', `Has alcanzado el límite de usuarios de tu plan actual (${limit}). Actualiza tu plan para añadir más.`);
    }
  }

  static async assertCanCreateBranch(db: Kysely<Database>, tenantId: string): Promise<void> {
    const subscriptionInfo = await db.selectFrom('tenant_subscriptions')
      .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
      .select('billing_plans.features_json')
      .where('tenant_subscriptions.tenant_id', '=', tenantId)
      .where('tenant_subscriptions.status', '=', 'ACTIVE')
      .executeTakeFirst();

    if (!subscriptionInfo) {
      throw new AppError(403, 'QUOTA_EXCEEDED', 'No se encontró una suscripción activa para este tenant.');
    }

    const features = subscriptionInfo.features_json as PlanFeatures;
    const limit = features.branches ?? -1;

    if (limit === -1) {
      return; // Ilimitado
    }

    const { count } = await db.selectFrom('branches')
      .select(db.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    if (Number(count) >= limit) {
      throw new AppError(403, 'QUOTA_EXCEEDED', `Has alcanzado el límite de sucursales de tu plan actual (${limit}). Actualiza tu plan para crear más.`);
    }
  }
}
