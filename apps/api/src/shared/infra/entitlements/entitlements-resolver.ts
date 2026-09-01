import type { Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { Database } from '../db/schema.js';
import { executeAsTenant } from '../db/rls.js';
import {
  ASSIGNABLE_MODULES,
  ENTITLEMENT_KEYS,
  UNLIMITED,
  type AssignableModule,
  type EntitlementKey,
  type ServiceLevel
} from '@pos-dian/shared';

export interface ResolvedEntitlements {
  tenantId: string;
  planId: string | null;
  subscriptionStatus: string | null;
  serviceLevel: ServiceLevel;
  modules: AssignableModule[];
  limits: Record<EntitlementKey, number>;
}

const CACHE_PREFIX = 'entitlements:v1:';

/**
 * Cuánto vive la caché sin que nadie la invalide.
 *
 * Corto a propósito: la invalidación explícita cubre los cambios que hacemos nosotros
 * (cambio de plan, módulos, overrides), pero no cubre el paso del tiempo — una suscripción
 * que vence o un override que caduca cambian el resultado sin que nadie escriba nada. Cinco
 * minutos es el retraso máximo con el que un comercio puede seguir viendo lo que ya no le
 * corresponde, y es un techo aceptable para algo que el scheduler revisa a diario.
 */
const CACHE_TTL_SECONDS = 300;

const MODULE_SET = new Set<string>(ASSIGNABLE_MODULES);

/**
 * Resuelve qué puede hacer un comercio: sus módulos, sus límites y su nivel de servicio.
 *
 * Antes esto vivía en tres sitios que nadie sincronizaba —21 claims dentro del JWT, un
 * `switch` de 21 ramas en `requireModule` y 21 líneas en el frontend—, y como los módulos
 * viajaban firmados en el token, encender uno no surtía efecto hasta que el usuario cerraba
 * sesión. Ahora se resuelve por petición contra la base, con caché en Redis e invalidación
 * explícita: un cambio de plan se ve en la siguiente petición.
 */
export class EntitlementsResolver {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly redis?: Redis
  ) {}

  static cacheKey(tenantId: string): string {
    return `${CACHE_PREFIX}${tenantId}`;
  }

  async resolve(tenantId: string): Promise<ResolvedEntitlements> {
    const cached = await this.readCache(tenantId);
    if (cached) return cached;

    const resolved = await this.readFromDatabase(tenantId);
    await this.writeCache(resolved);
    return resolved;
  }

  /**
   * Se llama tras cualquier cambio de plan, de módulos o de overrides. Es barato y no pasa
   * nada por llamarlo de más; lo caro es olvidarlo, porque el comercio se queda viendo lo
   * anterior hasta que expire el TTL.
   */
  async invalidate(tenantId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(EntitlementsResolver.cacheKey(tenantId));
    } catch {
      // Una caché que no se puede invalidar caduca sola. No es motivo para tumbar la
      // operación que provocó el cambio.
    }
  }

  private async readCache(tenantId: string): Promise<ResolvedEntitlements | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(EntitlementsResolver.cacheKey(tenantId));
      return raw ? (JSON.parse(raw) as ResolvedEntitlements) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(resolved: ResolvedEntitlements): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        EntitlementsResolver.cacheKey(resolved.tenantId),
        JSON.stringify(resolved),
        'EX',
        CACHE_TTL_SECONDS
      );
    } catch {
      // Sin caché el sistema funciona igual, con una consulta más por petición.
    }
  }

  private async readFromDatabase(tenantId: string): Promise<ResolvedEntitlements> {
    const now = new Date();

    const subscription = await this.db
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    const planId = subscription?.plan_id ?? null;
    const status = subscription?.status ?? null;

    // Las tablas de plan son catálogo global, como `billing_plans`.
    const [planModules, planLimits] = planId
      ? await Promise.all([
          this.db.selectFrom('plan_modules').select('module').where('plan_id', '=', planId).execute(),
          this.db
            .selectFrom('plan_entitlements')
            .select(['entitlement_key', 'limit_value'])
            .where('plan_id', '=', planId)
            .execute()
        ])
      : [[], []];

    // Las de overrides llevan `tenant_id` y tienen RLS con FORCE: se leen en contexto.
    const { moduleOverrides, limitOverrides } = await executeAsTenant(this.db, tenantId, async (trx) => {
      const [mods, lims] = await Promise.all([
        trx
          .selectFrom('tenant_module_overrides')
          .select(['module', 'enabled'])
          .where('tenant_id', '=', tenantId)
          .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
          .execute(),
        trx
          .selectFrom('tenant_limit_overrides')
          .select(['entitlement_key', 'limit_value'])
          .where('tenant_id', '=', tenantId)
          .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
          .execute()
      ]);
      return { moduleOverrides: mods, limitOverrides: lims };
    });

    // Módulos = los del plan, más los concedidos, menos los revocados.
    const modules = new Set<string>(planModules.map((m) => m.module));
    for (const override of moduleOverrides) {
      if (override.enabled) modules.add(override.module);
      else modules.delete(override.module);
    }

    // Límites: sin fila, ilimitado — que es lo que hacía el `?? -1` anterior.
    const limits = Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, UNLIMITED])) as Record<
      EntitlementKey,
      number
    >;
    for (const row of planLimits) {
      if ((ENTITLEMENT_KEYS as readonly string[]).includes(row.entitlement_key)) {
        limits[row.entitlement_key as EntitlementKey] = row.limit_value;
      }
    }
    for (const row of limitOverrides) {
      if ((ENTITLEMENT_KEYS as readonly string[]).includes(row.entitlement_key)) {
        limits[row.entitlement_key as EntitlementKey] = row.limit_value;
      }
    }

    return {
      tenantId,
      planId,
      subscriptionStatus: status,
      serviceLevel: serviceLevelFor(status),
      modules: [...modules].filter((m): m is AssignableModule => MODULE_SET.has(m)),
      limits
    };
  }
}

/**
 * Estado de la suscripción → cuánto producto se ve.
 *
 * `PAST_DUE` conserva la caja a propósito. Un comercio en mora tiene que poder seguir
 * atendiendo: apagarle el punto de venta no acelera el pago, le hace perder el día y nos
 * convierte a nosotros en el problema. Lo que se apaga es el backoffice, que sí puede
 * esperar.
 */
export function serviceLevelFor(subscriptionStatus: string | null): ServiceLevel {
  switch (subscriptionStatus) {
    case 'TRIAL':
    case 'ACTIVE':
      return 'FULL';
    case 'PAST_DUE':
      return 'DEGRADED';
    default:
      // SUSPENDED, CANCELLED, o sin suscripción.
      return 'BLOCKED';
  }
}
