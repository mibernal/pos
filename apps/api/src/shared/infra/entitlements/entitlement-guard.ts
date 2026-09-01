import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from '../db/schema.js';
import { AppError } from '../errors/app-error.js';
import {
  ENTITLEMENT_LABELS,
  UNLIMITED,
  isEnforceable,
  type EntitlementKey
} from '@pos-dian/shared';
import type { EntitlementsResolver, ResolvedEntitlements } from './entitlements-resolver.js';

type DbClient = Kysely<Database> | Transaction<Database>;

/**
 * Cómo se cuenta lo que ya existe, por dimensión.
 *
 * Se cuenta el estado real, no un contador que alguien tenga que mantener al día: un
 * contador desincronizado es peor que no tenerlo, porque miente con confianza.
 */
const COUNTERS: Record<EntitlementKey, (db: DbClient, tenantId: string) => Promise<number>> = {
  users: async (db, tenantId) => count(db, 'users', tenantId, (q) => q.where('active', '=', true)),
  branches: async (db, tenantId) => count(db, 'branches', tenantId),
  products: async (db, tenantId) => count(db, 'products', tenantId, (q) => q.where('active', '=', true)),
  terminals: async (db, tenantId) => count(db, 'terminals', tenantId, (q) => q.where('is_active', '=', true)),
  waiters: async (db, tenantId) => count(db, 'waiters', tenantId, (q) => q.where('is_active', '=', true)),
  tables: async (db, tenantId) => count(db, 'tables', tenantId),
  monthly_sales: async (db, tenantId) => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const row = await db
      .selectFrom('sales')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('tenant_id', '=', tenantId)
      .where('created_at', '>=', start)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function count(db: DbClient, table: any, tenantId: string, refine?: (q: any) => any): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (db as any)
    .selectFrom(table)
    .select((eb: any) => eb.fn.count('id').as('count')) // eslint-disable-line @typescript-eslint/no-explicit-any
    .where('tenant_id', '=', tenantId);

  if (refine) query = refine(query);

  const row = await query.executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * Comprueba las cuotas del plan antes de crear algo.
 *
 * Sustituye a `QuotaGuard`, que solo conocía usuarios y sucursales y leía el límite de un
 * `features_json` con dos claves. Dos diferencias que importan:
 *
 * 1. **Las dimensiones vienen del catálogo**, no del código: añadir una es una fila, no un
 *    método nuevo.
 * 2. **El conteo se serializa.** El guard anterior contaba y luego insertaba en dos pasos
 *    sin lock, así que dos peticiones simultáneas veían el mismo conteo y ambas pasaban: un
 *    plan de 3 usuarios acababa con 4. Ahora se toma un `pg_advisory_xact_lock` por comercio
 *    y dimensión, que se suelta solo al terminar la transacción — de modo que el guard solo
 *    sirve **dentro** de la transacción que hace la inserción, y por eso exige una.
 */
export class EntitlementGuard {
  constructor(private readonly resolver: EntitlementsResolver) {}

  /**
   * @param trx  La transacción que va a insertar. No es opcional a propósito: comprobar la
   *             cuota fuera de la transacción que crea el registro es exactamente la carrera
   *             que esto viene a cerrar.
   */
  async assertCanCreate(trx: Transaction<Database>, tenantId: string, key: EntitlementKey): Promise<void> {
    if (!isEnforceable(key)) {
      // `monthly_sales` se mide, no se bloquea: cortar la facturación de un comercio a
      // mitad de servicio no es una decisión que un límite comercial deba tomar.
      return;
    }

    // Los entitlements se resuelven antes de tomar el lock: la resolución abre su propia
    // transacción para leer los overrides y no debe hacerlo con un lock en la mano.
    const entitlements = await this.resolver.resolve(tenantId);

    this.assertServiceAllowsWrites(entitlements);

    const limit = entitlements.limits[key] ?? UNLIMITED;
    if (limit === UNLIMITED) return;

    // Serializa a los que crean la misma dimensión del mismo comercio. Dos claves enteras
    // porque `pg_advisory_xact_lock(int, int)` acepta ese par: comercio y dimensión.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${key}))`.execute(trx);

    const used = await COUNTERS[key](trx, tenantId);

    if (used >= limit) {
      throw new AppError(
        403,
        'QUOTA_EXCEEDED',
        `Has alcanzado el límite de ${ENTITLEMENT_LABELS[key].toLowerCase()} de tu plan actual (${limit}). Actualiza tu plan para añadir más.`,
        { key, limit, used }
      );
    }
  }

  /** Uso actual contra el límite, para el portal del comercio y el panel de plataforma. */
  async usage(db: DbClient, tenantId: string) {
    const entitlements = await this.resolver.resolve(tenantId);

    const rows = await Promise.all(
      (Object.keys(COUNTERS) as EntitlementKey[]).map(async (key) => ({
        key,
        label: ENTITLEMENT_LABELS[key],
        used: await COUNTERS[key](db, tenantId),
        limit: entitlements.limits[key] ?? UNLIMITED,
        enforced: isEnforceable(key)
      }))
    );

    return rows;
  }

  private assertServiceAllowsWrites(entitlements: ResolvedEntitlements) {
    if (entitlements.serviceLevel === 'BLOCKED') {
      throw new AppError(
        403,
        'SUBSCRIPTION_INACTIVE',
        'Tu suscripción no está activa. Reactívala para poder seguir configurando tu negocio.'
      );
    }
  }
}
