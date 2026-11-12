import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';

type DbClient = Kysely<Database> | Transaction<Database>;

export interface ResolvedPlan {
  id: string;
  name: string;
  price_cents: number;
  billing_cycle: string;
}

/**
 * Resuelve la referencia a un plan que llega desde el panel de plataforma.
 *
 * El alta de comercios buscaba el plan por `billing_plans.name` mientras el catálogo se
 * identifica por `id`: `id: 'STARTER'`, `name: 'Plan Starter'`. El formulario del panel
 * arranca con `'STARTER'` y sus opciones valen `p.name`, así que un administrador que no
 * tocaba el desplegable enviaba un identificador que la consulta por nombre no encontraba
 * nunca. El `if (planRow)` de `CreateTenantUseCase` se saltaba entonces la creación de la
 * suscripción **y devolvía 201**: el comercio quedaba creado y sin suscripción, y a partir
 * de ahí toda cuota le respondía 403 y su plan viajaba como `null` dentro del JWT.
 *
 * Se acepta el nombre además del identificador porque hay llamadores que envían cada cosa,
 * pero lo que no se acepta es no encontrarlo: un plan inválido es un 400, no un silencio.
 */
export async function resolveBillingPlan(db: DbClient, planRef: string): Promise<ResolvedPlan> {
  const reference = planRef?.trim();

  if (!reference) {
    throw new AppError(400, 'PLAN_NOT_FOUND', 'Debes indicar un plan de suscripción');
  }

  const selectActivePlans = () =>
    db
      .selectFrom('billing_plans')
      .select(['id', 'name', 'price_cents', 'billing_cycle'])
      .where('active', '=', true)
      .where('archived_at', 'is', null);

  // Se busca primero por id: es el identificador estable, mientras que el nombre se puede
  // editar desde el panel de planes.
  const plan =
    (await selectActivePlans().where('id', '=', reference).executeTakeFirst()) ??
    (await selectActivePlans().where('name', '=', reference).executeTakeFirst());

  if (!plan) {
    const available = await db
      .selectFrom('billing_plans')
      .select(['id'])
      .where('active', '=', true)
      .where('archived_at', 'is', null)
      .orderBy('price_cents', 'asc')
      .execute();

    throw new AppError(
      400,
      'PLAN_NOT_FOUND',
      `El plan «${reference}» no existe o no está activo. Planes disponibles: ${available.map((p) => p.id).join(', ') || 'ninguno'}`
    );
  }

  return plan;
}

/**
 * Días que dura un periodo según el ciclo del plan.
 *
 * La activación y la renovación sumaban 30 días fijos sin mirar `billing_cycle`, que sí se
 * le pasaba a la pasarela para cobrar: un comercio que pagaba un año entero recibía un mes
 * de servicio y los once restantes los tenía que reponer alguien a mano.
 */
export function periodDaysForCycle(billingCycle: string): number {
  return billingCycle === 'YEARLY' ? 365 : 30;
}
