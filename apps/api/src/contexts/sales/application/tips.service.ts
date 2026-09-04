import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  PAYMENT_KIND_BEHAVIOR,
  splitPool,
  type PaymentKind,
  type TipPolicy,
  type TipShare,
  type TipSummary
} from '@pos-dian/shared';

/**
 * Propinas del turno: cuánto se juntó, de quién es y cómo se paga.
 *
 * La distinción que sostiene todo esto es entre la propina que está **en el cajón** y la
 * que cobró el comercio por otro medio. Pagarlas igual sería sacar del cajón un dinero que
 * nunca entró en él, y el arqueo lo cantaría como faltante esa misma noche.
 */
export class TipsService {
  static async settings(trx: Transaction<Database>, tenantId: string): Promise<{ policy: TipPolicy; autoSettle: boolean }> {
    const fila = await trx
      .selectFrom('tenant_tip_settings')
      .select(['policy', 'auto_settle_on_close'])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return {
      policy: (fila?.policy as TipPolicy) ?? 'INDIVIDUAL',
      autoSettle: fila?.auto_settle_on_close ?? false
    };
  }

  static async saveSettings(
    trx: Transaction<Database>,
    tenantId: string,
    input: { policy: TipPolicy; auto_settle_on_close: boolean }
  ): Promise<void> {
    await trx
      .insertInto('tenant_tip_settings')
      .values({
        tenant_id: tenantId,
        policy: input.policy,
        auto_settle_on_close: input.auto_settle_on_close
      })
      .onConflict((oc) =>
        oc.column('tenant_id').doUpdateSet({
          policy: input.policy,
          auto_settle_on_close: input.auto_settle_on_close,
          updated_at: new Date()
        })
      )
      .execute();
  }

  /**
   * Reparto del turno, sin escribir nada. Es lo que se muestra antes de pagar: quién juntó
   * cuánto, y de eso qué parte está en el cajón.
   */
  static async summary(
    trx: Transaction<Database>,
    tenantId: string,
    cashSessionId: string
  ): Promise<TipSummary> {
    const { policy } = await this.settings(trx, tenantId);

    const filas = await trx
      .selectFrom('sale_payments as sp')
      .innerJoin('sales as s', 's.id', 'sp.sale_id')
      .leftJoin('waiters as w', 'w.id', 's.waiter_id')
      .select((eb) => [
        's.waiter_id',
        'w.name as waiter_name',
        'sp.kind',
        eb.fn.sum<number>('sp.tip_cents').as('tip_cents'),
        eb.fn.count<number>(sql`distinct s.id`).as('sales_count')
      ])
      .where('sp.tenant_id', '=', tenantId)
      .where('sp.cash_session_id', '=', cashSessionId)
      .where('s.status', '=', 'COMPLETED')
      .where('sp.tip_cents', '>', 0)
      .groupBy(['s.waiter_id', 'w.name', 'sp.kind'])
      .execute();

    const porMesero = new Map<string, TipShare>();

    for (const fila of filas) {
      const clave = fila.waiter_id ?? 'SIN_MESERO';
      const importe = Number(fila.tip_cents);
      const enCajon = PAYMENT_KIND_BEHAVIOR[fila.kind as PaymentKind].affectsCashDrawer;

      const share = porMesero.get(clave) ?? {
        waiter_id: fila.waiter_id,
        // Una propina sin mesero asignado existe —la venta de mostrador también la recibe—
        // y tiene que aparecer, no desaparecer del reparto.
        waiter_name: fila.waiter_name ?? 'Sin mesero asignado',
        sales_count: 0,
        earned_cents: 0,
        cash_cents: 0,
        electronic_cents: 0
      };

      share.earned_cents += importe;
      share.sales_count += Number(fila.sales_count);
      if (enCajon) share.cash_cents += importe;
      else share.electronic_cents += importe;

      porMesero.set(clave, share);
    }

    let shares = [...porMesero.values()].sort((a, b) => b.earned_cents - a.earned_cents);

    const totalCents = shares.reduce((suma, share) => suma + share.earned_cents, 0);
    const cashCents = shares.reduce((suma, share) => suma + share.cash_cents, 0);
    const electronicCents = totalCents - cashCents;

    /**
     * En bolsa común se reparte por partes iguales entre quienes atendieron, conservando la
     * proporción entre efectivo y electrónico del total: si dos tercios de la propina del
     * turno llegaron en efectivo, cada mesero cobra dos tercios de lo suyo en efectivo. Sin
     * eso, uno podría llevarse todo el efectivo del cajón y otro solo un apunte contable.
     */
    if (policy === 'POOL' && shares.length > 0) {
      const partes = splitPool(totalCents, shares.length);
      const partesCash = splitPool(cashCents, shares.length);

      shares = shares.map((share, index) => ({
        ...share,
        earned_cents: partes[index]!,
        cash_cents: Math.min(partes[index]!, partesCash[index]!),
        electronic_cents: partes[index]! - Math.min(partes[index]!, partesCash[index]!)
      }));
    }

    const liquidacion = await trx
      .selectFrom('tip_settlements')
      .select(['created_at'])
      .where('tenant_id', '=', tenantId)
      .where('cash_session_id', '=', cashSessionId)
      .executeTakeFirst();

    return {
      policy,
      total_cents: totalCents,
      cash_cents: cashCents,
      electronic_cents: electronicCents,
      shares,
      settled: Boolean(liquidacion),
      settled_at: liquidacion ? liquidacion.created_at.toISOString() : null
    };
  }

  /**
   * Liquida las propinas del turno.
   *
   * Si el efectivo se entrega ahora, se registra el movimiento de caja que lo saca del
   * cajón. **Ese movimiento es el punto de toda la funcionalidad**: sin él, el mesero se
   * lleva su dinero, el cajero cuenta menos de lo esperado, y la diferencia aparece como un
   * faltante que nadie sabe explicar.
   */
  static async settle(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      branchId: string;
      cashSessionId: string;
      userId: string;
      payCashNow: boolean;
      notes?: string | null;
    }
  ): Promise<{ settlementId: string; summary: TipSummary; cashMovementId: string | null }> {
    const yaLiquidado = await trx
      .selectFrom('tip_settlements')
      .select('id')
      .where('tenant_id', '=', input.tenantId)
      .where('cash_session_id', '=', input.cashSessionId)
      .executeTakeFirst();

    if (yaLiquidado) {
      throw new AppError(409, 'TIPS_ALREADY_SETTLED', 'Las propinas de este turno ya se liquidaron');
    }

    const summary = await this.summary(trx, input.tenantId, input.cashSessionId);

    if (summary.total_cents === 0) {
      throw new AppError(400, 'NO_TIPS_TO_SETTLE', 'Este turno no tiene propinas que liquidar');
    }

    const settlementId = randomUUID();
    let cashMovementId: string | null = null;

    if (input.payCashNow && summary.cash_cents > 0) {
      cashMovementId = randomUUID();

      await trx
        .insertInto('cash_movements')
        .values({
          id: cashMovementId,
          tenant_id: input.tenantId,
          cash_session_id: input.cashSessionId,
          user_id: input.userId,
          type: 'OUT',
          amount_cents: summary.cash_cents,
          reason: 'Pago de propinas del turno'
        })
        .execute();
    }

    await trx
      .insertInto('tip_settlements')
      .values({
        id: settlementId,
        tenant_id: input.tenantId,
        branch_id: input.branchId,
        cash_session_id: input.cashSessionId,
        policy: summary.policy,
        total_cents: summary.total_cents,
        cash_cents: summary.cash_cents,
        electronic_cents: summary.electronic_cents,
        settled_by_user_id: input.userId,
        cash_movement_id: cashMovementId,
        notes: input.notes ?? null
      })
      .execute();

    await trx
      .insertInto('tip_settlement_items')
      .values(
        summary.shares.map((share) => ({
          id: randomUUID(),
          tenant_id: input.tenantId,
          settlement_id: settlementId,
          waiter_id: share.waiter_id,
          waiter_name: share.waiter_name,
          sales_count: share.sales_count,
          earned_cents: share.earned_cents,
          cash_cents: share.cash_cents,
          electronic_cents: share.electronic_cents
        }))
      )
      .execute();

    return { settlementId, summary: { ...summary, settled: true }, cashMovementId };
  }
}
