import type { Kysely } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { resolveBillingPlan, periodDaysForCycle } from '../billing-plans/resolve-plan.js';
import { LIVE_SUBSCRIPTION_STATUSES } from '../../../billing/application/subscription.service.js';
import { EntitlementGuard } from '../../../../shared/infra/entitlements/entitlement-guard.js';
import { EntitlementsResolver } from '../../../../shared/infra/entitlements/entitlements-resolver.js';
import {
  ENTITLEMENT_LABELS,
  UNLIMITED,
  isEnforceable,
  type AssignableModule,
  type EntitlementKey,
  type PlanChangePreview
} from '@pos-dian/shared';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Qué pasaría si este comercio cambiara de plan.
 *
 * Antes, cambiar de plan era un `UPDATE plan_id` y nada más: subir a mitad de periodo no
 * cobraba la diferencia, y bajar de PRO a STARTER con ocho usuarios activos dejaba al
 * comercio permanentemente por encima de su cuota sin decírselo a nadie. Quien lo hacía no
 * tenía forma de saber qué estaba rompiendo hasta que el cliente llamaba.
 *
 * Esto responde las tres preguntas antes de tocar nada: qué módulos gana y pierde, qué
 * límites quedarían por debajo de lo que ya usa, y cuánto dinero implica el cambio.
 */
export class PreviewPlanChangeUseCase {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly resolver: EntitlementsResolver
  ) {}

  async execute(tenantId: string, targetPlanRef: string): Promise<PlanChangePreview> {
    const target = await resolveBillingPlan(this.db, targetPlanRef);

    const subscription = await this.db
      .selectFrom('tenant_subscriptions')
      .select(['plan_id', 'current_period_end', 'current_period_start'])
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', LIVE_SUBSCRIPTION_STATUSES)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (!subscription) {
      throw new AppError(404, 'NOT_FOUND', 'El comercio no tiene una suscripción vigente');
    }

    const currentPlan = await this.db
      .selectFrom('billing_plans')
      .select(['id', 'price_cents', 'billing_cycle'])
      .where('id', '=', subscription.plan_id)
      .executeTakeFirst();

    const [currentEntitlements, targetModules, targetLimits] = await Promise.all([
      this.resolver.resolve(tenantId),
      this.db.selectFrom('plan_modules').select('module').where('plan_id', '=', target.id).execute(),
      this.db
        .selectFrom('plan_entitlements')
        .select(['entitlement_key', 'limit_value'])
        .where('plan_id', '=', target.id)
        .execute()
    ]);

    // ── Módulos ───────────────────────────────────────────────────────────────
    // Se compara contra lo que el comercio tiene **resuelto**, no contra su plan: si tiene
    // un módulo concedido por excepción, ese no lo pierde al cambiar de plan y no debe
    // aparecer como pérdida.
    const current = new Set(currentEntitlements.modules);
    const after = new Set<AssignableModule>(targetModules.map((m) => m.module as AssignableModule));

    const overrides = await this.db
      .selectFrom('tenant_module_overrides')
      .select(['module', 'enabled'])
      .where('tenant_id', '=', tenantId)
      .execute();

    for (const override of overrides) {
      if (override.enabled) after.add(override.module as AssignableModule);
      else after.delete(override.module as AssignableModule);
    }

    const modulesGained = [...after].filter((m) => !current.has(m)).sort();
    const modulesLost = [...current].filter((m) => !after.has(m)).sort();

    // ── Límites que quedarían cortos ──────────────────────────────────────────
    const guard = new EntitlementGuard(this.resolver);
    const usage = await guard.usage(this.db, tenantId);
    const targetLimitByKey = new Map(targetLimits.map((row) => [row.entitlement_key, row.limit_value]));

    const limitsOverQuota = usage
      .filter((row) => {
        if (!isEnforceable(row.key as EntitlementKey)) return false;
        const newLimit = targetLimitByKey.get(row.key) ?? UNLIMITED;
        return newLimit !== UNLIMITED && row.used > newLimit;
      })
      .map((row) => ({
        key: row.key as EntitlementKey,
        label: ENTITLEMENT_LABELS[row.key as EntitlementKey],
        used: row.used,
        new_limit: targetLimitByKey.get(row.key) ?? UNLIMITED
      }));

    // ── Dinero ────────────────────────────────────────────────────────────────
    const proration = computeProration({
      periodEnd: subscription.current_period_end,
      currentPriceCents: currentPlan?.price_cents ?? 0,
      currentCycleDays: periodDaysForCycle(currentPlan?.billing_cycle ?? 'MONTHLY'),
      targetPriceCents: target.price_cents,
      targetCycleDays: periodDaysForCycle(target.billing_cycle)
    });

    const currentPrice = currentPlan?.price_cents ?? 0;

    return {
      current_plan_id: subscription.plan_id,
      target_plan_id: target.id,
      direction:
        target.price_cents > currentPrice ? 'UPGRADE' : target.price_cents < currentPrice ? 'DOWNGRADE' : 'SAME_PRICE',
      modules_gained: modulesGained,
      modules_lost: modulesLost,
      limits_over_quota: limitsOverQuota,
      proration
    };
  }
}

/**
 * Prorrateo por días, no por dinero cobrado.
 *
 * No hay cobro recurrente todavía —eso es la fase 8—, así que emitir un cargo aquí sería
 * inventar un movimiento que nadie concilia. Lo que sí se puede hacer con honestidad es
 * convertir el valor no consumido del plan actual en días del plan nuevo: el comercio no
 * pierde lo que pagó y el periodo queda ajustado. Cuando exista el cobro recurrente, el
 * `charge_cents` que se devuelve aquí es lo que habrá que cobrar en su lugar.
 */
export function computeProration(input: {
  periodEnd: Date | null;
  currentPriceCents: number;
  currentCycleDays: number;
  targetPriceCents: number;
  targetCycleDays: number;
}) {
  const now = Date.now();
  const end = input.periodEnd ? new Date(input.periodEnd).getTime() : now;
  const unusedDays = Math.max(0, Math.ceil((end - now) / MS_PER_DAY));

  const currentDailyCents = input.currentCycleDays > 0 ? input.currentPriceCents / input.currentCycleDays : 0;
  const targetDailyCents = input.targetCycleDays > 0 ? input.targetPriceCents / input.targetCycleDays : 0;

  const creditCents = Math.round(unusedDays * currentDailyCents);

  // Días del plan nuevo que compra el crédito. Con un plan gratuito o mal configurado el
  // divisor es cero: se conservan los días que quedaban en vez de dividir por cero.
  const daysGranted = targetDailyCents > 0 ? Math.floor(creditCents / targetDailyCents) : unusedDays;

  const newPeriodEnd = new Date(now + daysGranted * MS_PER_DAY);

  return {
    unused_days: unusedDays,
    credit_cents: creditCents,
    charge_cents: Math.max(0, Math.round(unusedDays * targetDailyCents) - creditCents),
    days_granted: daysGranted,
    new_period_end: newPeriodEnd.toISOString()
  };
}
