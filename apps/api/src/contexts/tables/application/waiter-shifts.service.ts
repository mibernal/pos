import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import {
  PAYMENT_KIND_BEHAVIOR,
  type OpenWaiterShiftInput,
  type PaymentKind,
  type WaiterShiftSummary
} from '@pos-dian/shared';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import { verifyPassword } from '../../identity/auth/password.js';

/**
 * Turnos de mesero.
 *
 * El corte de un turno se calcula por **rango de tiempo**: las ventas de ese mesero entre la
 * apertura y el cierre. No lleva una columna en `sales` a propósito — tocar el camino de
 * creación de la venta, que es el más delicado del sistema, para algo que se puede deducir
 * sería un mal cambio. La deducción es exacta mientras un mesero no tenga dos turnos
 * solapados, y de eso se encarga el índice único parcial de la migración 107.
 */
export class WaiterShiftsService {
  /**
   * Resuelve quién entra.
   *
   * El PIN se compara contra los meseros activos de la sucursal, uno a uno, porque Argon2
   * sala cada hash y no se puede buscar por igualdad. Son pocos y la unicidad por sucursal
   * —que ya se exigía al guardarlo— garantiza que como mucho uno coincida.
   *
   * Es la primera vez que ese PIN sirve para algo: hasta ahora se guardaba, se validaba que
   * fuera único y nada lo verificaba nunca.
   */
  private static async resolveWaiter(
    trx: Transaction<Database>,
    tenantId: string,
    branchId: string,
    input: OpenWaiterShiftInput
  ): Promise<{ id: string; name: string }> {
    if (input.waiter_id) {
      const mesero = await trx
        .selectFrom('waiters')
        .select(['id', 'name'])
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('id', '=', input.waiter_id)
        .where('is_active', '=', true)
        .executeTakeFirst();

      if (!mesero) {
        throw new AppError(404, 'WAITER_NOT_FOUND', 'Ese mesero no existe en esta sucursal.');
      }
      return mesero;
    }

    const candidatos = await trx
      .selectFrom('waiters')
      .select(['id', 'name', 'pin_hash'])
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .where('pin_hash', 'is not', null)
      .execute();

    for (const candidato of candidatos) {
      if (candidato.pin_hash && (await verifyPassword(input.pin!, candidato.pin_hash))) {
        return { id: candidato.id, name: candidato.name };
      }
    }

    /**
     * El mensaje no distingue «no hay nadie con ese PIN» de «ese mesero está inactivo»: en
     * una pantalla que está a la vista del comedor, decir cuál de las dos cosas es sirve
     * sobre todo para adivinar PIN ajenos.
     */
    throw new AppError(401, 'WAITER_PIN_INVALID', 'PIN incorrecto.');
  }

  static async open(
    trx: Transaction<Database>,
    tenantId: string,
    input: OpenWaiterShiftInput,
    openedByUserId: string
  ) {
    const sucursal = await trx
      .selectFrom('branches')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', input.branch_id)
      .executeTakeFirst();

    if (!sucursal) {
      throw new AppError(404, 'BRANCH_NOT_FOUND', 'La sucursal no existe o no es de este comercio.');
    }

    const mesero = await this.resolveWaiter(trx, tenantId, input.branch_id, input);

    /**
     * Serializa las aperturas del mismo mesero. El índice único parcial ya impide el turno
     * duplicado, pero sin el lock la segunda apertura simultánea responde un error de índice
     * en vez del mensaje que explica lo que pasa.
     */
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`waiter-shift:${tenantId}`}), hashtext(${mesero.id}))`.execute(trx);

    const abierto = await trx
      .selectFrom('waiter_shifts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('waiter_id', '=', mesero.id)
      .where('closed_at', 'is', null)
      .executeTakeFirst();

    if (abierto) {
      throw new AppError(
        409,
        'WAITER_SHIFT_ALREADY_OPEN',
        `${mesero.name} ya tiene un turno abierto. Ciérralo antes de abrir otro.`,
        { shift_id: abierto.id }
      );
    }

    if (input.cash_session_id) {
      const caja = await trx
        .selectFrom('cash_sessions')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', input.cash_session_id)
        .where('status', '=', 'OPEN')
        .executeTakeFirst();

      if (!caja) {
        throw new AppError(404, 'CASH_SESSION_NOT_FOUND', 'Ese turno de caja no existe o ya se cerró.');
      }
    }

    const shiftId = randomUUID();

    await trx
      .insertInto('waiter_shifts')
      .values({
        id: shiftId,
        tenant_id: tenantId,
        branch_id: input.branch_id,
        waiter_id: mesero.id,
        cash_session_id: input.cash_session_id ?? null,
        opened_by_user_id: openedByUserId,
        notes: input.notes ?? null
      })
      .execute();

    const mesas = await this.assignTables(trx, tenantId, input.branch_id, shiftId, mesero.id, input.table_ids ?? []);

    return {
      id: shiftId,
      tenant_id: tenantId,
      branch_id: input.branch_id,
      waiter_id: mesero.id,
      waiter_name: mesero.name,
      cash_session_id: input.cash_session_id ?? null,
      opened_at: new Date().toISOString(),
      closed_at: null,
      notes: input.notes ?? null,
      table_ids: mesas
    };
  }

  /**
   * Le entrega las mesas al mesero y las deja anotadas en el turno.
   *
   * Las dos cosas: `tables.waiter_id` es lo que mira la pantalla de mesas hoy, y
   * `waiter_shift_tables` es el registro histórico —qué le tocó atender ese día— que
   * sobrevive a que la mesa se reasigne después.
   */
  private static async assignTables(
    trx: Transaction<Database>,
    tenantId: string,
    branchId: string,
    shiftId: string,
    waiterId: string,
    tableIds: string[]
  ): Promise<string[]> {
    if (tableIds.length === 0) return [];

    const mesas = await trx
      .selectFrom('tables')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('id', 'in', tableIds)
      .execute();

    if (mesas.length !== new Set(tableIds).size) {
      throw new AppError(404, 'TABLE_NOT_FOUND', 'Alguna de esas mesas no existe en la sucursal.');
    }

    await trx
      .insertInto('waiter_shift_tables')
      .values(
        mesas.map((mesa) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          shift_id: shiftId,
          table_id: mesa.id
        }))
      )
      .execute();

    await trx
      .updateTable('tables')
      .set({ waiter_id: waiterId, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where(
        'id',
        'in',
        mesas.map((mesa) => mesa.id)
      )
      .execute();

    return mesas.map((mesa) => mesa.id);
  }

  /**
   * El corte del turno: qué vendió y cuánta propina generó.
   *
   * La propina se parte en la que está en el cajón —que se le puede entregar al salir— y la
   * que cobró el comercio por tarjeta, que se paga por nómina. Es la misma distinción que
   * hace la liquidación por turno de caja de la fase 9, aplicada a la persona.
   */
  static async summary(
    trx: Transaction<Database>,
    tenantId: string,
    shiftId: string
  ): Promise<WaiterShiftSummary> {
    const turno = await trx
      .selectFrom('waiter_shifts as ws')
      .innerJoin('waiters as w', 'w.id', 'ws.waiter_id')
      .select([
        'ws.id',
        'ws.waiter_id',
        'ws.branch_id',
        'ws.opened_at',
        'ws.closed_at',
        'ws.summary_json',
        'w.name as waiter_name'
      ])
      .where('ws.tenant_id', '=', tenantId)
      .where('ws.id', '=', shiftId)
      .executeTakeFirst();

    if (!turno) {
      throw new AppError(404, 'WAITER_SHIFT_NOT_FOUND', 'Ese turno no existe.');
    }

    // Un turno cerrado devuelve el corte que se congeló al cerrarlo, no uno recalculado.
    if (turno.summary_json) {
      return turno.summary_json as unknown as WaiterShiftSummary;
    }

    const hasta = turno.closed_at ?? new Date();

    const ventas = await trx
      .selectFrom('sales')
      .select((eb) => [
        eb.fn.count<number>('id').as('sales_count'),
        eb.fn.coalesce(eb.fn.sum<number>('total_cents'), eb.lit(0)).as('sales_total_cents')
      ])
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', turno.branch_id)
      .where('waiter_id', '=', turno.waiter_id)
      .where('status', '=', 'COMPLETED')
      .where('created_at', '>=', turno.opened_at)
      .where('created_at', '<=', hasta)
      .executeTakeFirstOrThrow();

    const propinas = await trx
      .selectFrom('sale_payments as sp')
      .innerJoin('sales as s', 's.id', 'sp.sale_id')
      .select((eb) => ['sp.kind', eb.fn.sum<number>('sp.tip_cents').as('tip_cents')])
      .where('sp.tenant_id', '=', tenantId)
      .where('s.waiter_id', '=', turno.waiter_id)
      .where('s.status', '=', 'COMPLETED')
      .where('s.created_at', '>=', turno.opened_at)
      .where('s.created_at', '<=', hasta)
      .where('sp.tip_cents', '>', 0)
      .groupBy('sp.kind')
      .execute();

    let enCajon = 0;
    let electronica = 0;
    for (const fila of propinas) {
      const importe = Number(fila.tip_cents);
      if (PAYMENT_KIND_BEHAVIOR[fila.kind as PaymentKind]?.affectsCashDrawer) enCajon += importe;
      else electronica += importe;
    }

    const mesas = await trx
      .selectFrom('waiter_shift_tables')
      .select((eb) => eb.fn.count<number>('id').as('total'))
      .where('tenant_id', '=', tenantId)
      .where('shift_id', '=', shiftId)
      .executeTakeFirstOrThrow();

    const comensales = await trx
      .selectFrom('table_orders')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('guests_count'), eb.lit(0)).as('total'))
      .where('tenant_id', '=', tenantId)
      .where('waiter_id', '=', turno.waiter_id)
      .where('created_at', '>=', turno.opened_at)
      .where('created_at', '<=', hasta)
      .executeTakeFirstOrThrow();

    return {
      shift_id: turno.id,
      waiter_id: turno.waiter_id,
      waiter_name: turno.waiter_name,
      opened_at: new Date(turno.opened_at).toISOString(),
      closed_at: turno.closed_at ? new Date(turno.closed_at).toISOString() : null,
      sales_count: Number(ventas.sales_count),
      sales_total_cents: Number(ventas.sales_total_cents),
      tips_total_cents: enCajon + electronica,
      tips_cash_cents: enCajon,
      tips_electronic_cents: electronica,
      tables_served: Number(mesas.total),
      guests_served: Number(comensales.total)
    };
  }

  static async close(
    trx: Transaction<Database>,
    tenantId: string,
    shiftId: string,
    closedByUserId: string,
    notes?: string
  ): Promise<WaiterShiftSummary> {
    const turno = await trx
      .selectFrom('waiter_shifts')
      .select(['id', 'waiter_id', 'closed_at'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shiftId)
      .forUpdate()
      .executeTakeFirst();

    if (!turno) {
      throw new AppError(404, 'WAITER_SHIFT_NOT_FOUND', 'Ese turno no existe.');
    }

    if (turno.closed_at) {
      throw new AppError(409, 'WAITER_SHIFT_ALREADY_CLOSED', 'Ese turno ya está cerrado.');
    }

    const cerradoEn = new Date();

    await trx
      .updateTable('waiter_shifts')
      .set({ closed_at: cerradoEn, closed_by_user_id: closedByUserId, ...(notes ? { notes } : {}) })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shiftId)
      .execute();

    const corte = await this.summary(trx, tenantId, shiftId);

    /**
     * El corte se congela. Recalcularlo meses después daría otro número —una venta anulada,
     * una propina corregida— y el papel que el mesero se llevó a casa diría otra cosa.
     */
    await trx
      .updateTable('waiter_shifts')
      .set({ summary_json: corte as never })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shiftId)
      .execute();

    /**
     * Se le sueltan las mesas, pero solo las que siguen siendo suyas: si durante el servicio
     * alguien reasignó una mesa a otro mesero, quitársela al cerrar el turno le borraría el
     * trabajo al que la tiene ahora.
     */
    await trx
      .updateTable('tables')
      .set({ waiter_id: null, updated_at: cerradoEn })
      .where('tenant_id', '=', tenantId)
      .where('waiter_id', '=', turno.waiter_id)
      .where((eb) =>
        eb(
          'id',
          'in',
          eb.selectFrom('waiter_shift_tables').select('table_id').where('shift_id', '=', shiftId)
        )
      )
      .execute();

    return corte;
  }

  /** Los turnos de una sucursal: los abiertos primero, que es lo que mira el encargado. */
  static async list(trx: Transaction<Database>, tenantId: string, branchId: string, soloAbiertos: boolean) {
    let query = trx
      .selectFrom('waiter_shifts as ws')
      .innerJoin('waiters as w', 'w.id', 'ws.waiter_id')
      .select([
        'ws.id',
        'ws.waiter_id',
        'w.name as waiter_name',
        'ws.cash_session_id',
        'ws.opened_at',
        'ws.closed_at',
        'ws.notes'
      ])
      .where('ws.tenant_id', '=', tenantId)
      .where('ws.branch_id', '=', branchId)
      .orderBy('ws.opened_at', 'desc')
      .limit(100);

    if (soloAbiertos) query = query.where('ws.closed_at', 'is', null);

    const turnos = await query.execute();

    return turnos.map((turno) => ({
      ...turno,
      opened_at: new Date(turno.opened_at).toISOString(),
      closed_at: turno.closed_at ? new Date(turno.closed_at).toISOString() : null
    }));
  }
}
