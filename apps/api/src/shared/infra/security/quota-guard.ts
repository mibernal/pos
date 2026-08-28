import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { AppError } from '../errors/app-error.js';

type DbClient = Kysely<Database> | Transaction<Database>;

interface PlanFeatures {
  users?: number;
  branches?: number;
  support_level?: string;
}

/**
 * Estados de suscripción que dan derecho a seguir dando de alta usuarios y sucursales.
 *
 * `TRIAL` está aquí por un defecto que costaba clientes: el guard exigía `ACTIVE`, pero el
 * registro público crea la suscripción en `TRIAL` por 14 días. Durante toda la prueba,
 * crear un cajero o una segunda sucursal respondía `403 QUOTA_EXCEEDED · «No se encontró
 * una suscripción activa»` — un mensaje que además sugiere que el comercio agotó un límite
 * cuando lo que pasaba es que no podía ni empezar. El comercio no llegaba a montar su
 * negocio durante el periodo pensado justamente para que lo montara.
 *
 * `PAST_DUE` también da derecho: es el periodo de gracia, y durante la gracia el comercio
 * sigue operando. La suspensión por impago es `SUSPENDED`, y esa sí cierra la puerta.
 */
const ENTITLED_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE'] as const;

const UNLIMITED = -1;

export class QuotaGuard {
  static async assertCanCreateUser(db: DbClient, tenantId: string): Promise<void> {
    const limit = await QuotaGuard.resolveLimit(db, tenantId, 'users');
    if (limit === UNLIMITED) return;

    const { count } = await db
      .selectFrom('users')
      .select(db.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId)
      .where('active', '=', true)
      .executeTakeFirstOrThrow();

    if (Number(count) >= limit) {
      throw new AppError(
        403,
        'QUOTA_EXCEEDED',
        `Has alcanzado el límite de usuarios de tu plan actual (${limit}). Actualiza tu plan para añadir más.`
      );
    }
  }

  static async assertCanCreateBranch(db: DbClient, tenantId: string): Promise<void> {
    const limit = await QuotaGuard.resolveLimit(db, tenantId, 'branches');
    if (limit === UNLIMITED) return;

    const { count } = await db
      .selectFrom('branches')
      .select(db.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirstOrThrow();

    if (Number(count) >= limit) {
      throw new AppError(
        403,
        'QUOTA_EXCEEDED',
        `Has alcanzado el límite de sucursales de tu plan actual (${limit}). Actualiza tu plan para crear más.`
      );
    }
  }

  /**
   * Límite del plan para una dimensión, o `-1` si es ilimitado.
   *
   * Separar «tu suscripción no da derecho» de «agotaste tu cuota» no es cosmética: el
   * cliente web abre el modal de mejora de plan al ver `QUOTA_EXCEEDED`, y ofrecerle pagar
   * más a alguien cuyo problema es que su suscripción está suspendida no lleva a ningún
   * lado.
   */
  private static async resolveLimit(
    db: DbClient,
    tenantId: string,
    dimension: 'users' | 'branches'
  ): Promise<number> {
    const subscription = await db
      .selectFrom('tenant_subscriptions')
      .innerJoin('billing_plans', 'billing_plans.id', 'tenant_subscriptions.plan_id')
      .select(['billing_plans.features_json'])
      .where('tenant_subscriptions.tenant_id', '=', tenantId)
      .where('tenant_subscriptions.status', 'in', ENTITLED_STATUSES)
      .orderBy('tenant_subscriptions.created_at', 'desc')
      .executeTakeFirst();

    if (!subscription) {
      throw new AppError(
        403,
        'SUBSCRIPTION_INACTIVE',
        'Tu suscripción no está activa. Reactívala para poder seguir configurando tu negocio.'
      );
    }

    const features = (subscription.features_json ?? {}) as PlanFeatures;
    return features[dimension] ?? UNLIMITED;
  }
}
