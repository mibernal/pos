import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  PAYMENT_KIND_BEHAVIOR,
  availableCreditCents,
  type CreditAccount,
  type CustomerStatement,
  type PaymentKind,
  type Receivable,
  type ReceivableStatus,
  type UpsertCreditAccountInput
} from '@pos-dian/shared';

/**
 * Cuentas por cobrar del comercio.
 *
 * El saldo de un cliente **se deriva** de sus documentos pendientes, nunca se guarda como
 * contador. Es la misma disciplina que sigue `EntitlementGuard` al contar cuotas: un
 * contador desincronizado es peor que no tenerlo, porque miente con confianza — y aquí
 * mentiría sobre cuánto le debe una persona a otra.
 */
export class ReceivablesService {
  /**
   * Serializa las operaciones de crédito de un mismo cliente.
   *
   * Sin esto, dos ventas a crédito simultáneas leen el mismo saldo y las dos pasan el cupo:
   * un cliente con 100.000 de tope acaba debiendo 180.000. Es exactamente la carrera que la
   * fase 7 cerró en las cuotas de plan, y por la misma razón el lock tiene que vivir dentro
   * de la transacción que escribe.
   */
  private static async lockCustomer(trx: Transaction<Database>, tenantId: string, customerId: string) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`credit:${tenantId}`}), hashtext(${customerId}))`.execute(trx);
  }

  /** Saldo pendiente del cliente, sumando sus documentos abiertos. */
  static async balanceCents(trx: Transaction<Database>, tenantId: string, customerId: string): Promise<number> {
    const row = await trx
      .selectFrom('customer_receivables')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('balance_cents'), eb.lit(0)).as('balance'))
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .where('status', '=', 'OPEN')
      .executeTakeFirstOrThrow();

    return Number(row.balance);
  }

  /**
   * Comprueba que el cliente puede llevarse esta venta fiada, y deja el lock tomado para
   * que la creación del documento ocurra sin que nadie se cuele.
   */
  static async assertCanTakeCredit(
    trx: Transaction<Database>,
    input: { tenantId: string; customerId: string; amountCents: number }
  ): Promise<{ termsDays: number }> {
    await this.lockCustomer(trx, input.tenantId, input.customerId);

    const account = await trx
      .selectFrom('customer_credit_accounts')
      .select(['credit_limit_cents', 'terms_days', 'status'])
      .where('tenant_id', '=', input.tenantId)
      .where('customer_id', '=', input.customerId)
      .executeTakeFirst();

    /**
     * Sin cuenta de crédito no se fía. Es deliberado: abrir el cupo tiene que ser una
     * decisión del comercio, no algo que ocurra solo porque un cajero eligió «fiado» en la
     * pantalla de cobro.
     */
    if (!account) {
      throw new AppError(
        403,
        'CREDIT_ACCOUNT_REQUIRED',
        'Este cliente no tiene cupo de crédito habilitado. Configúraselo antes de fiarle.'
      );
    }

    if (account.status === 'BLOCKED') {
      throw new AppError(403, 'CREDIT_ACCOUNT_BLOCKED', 'El crédito de este cliente está bloqueado');
    }

    if (account.credit_limit_cents !== null) {
      const balance = await this.balanceCents(trx, input.tenantId, input.customerId);
      const available = availableCreditCents(account.credit_limit_cents, balance);

      if (available !== null && input.amountCents > available) {
        throw new AppError(
          403,
          'CREDIT_LIMIT_EXCEEDED',
          `El cupo disponible del cliente es de ${Math.round(available / 100)} y la venta es de ${Math.round(input.amountCents / 100)}`,
          { available_cents: available, requested_cents: input.amountCents, balance_cents: balance }
        );
      }
    }

    return { termsDays: account.terms_days };
  }

  static async createForSale(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      customerId: string;
      branchId: string;
      saleId: string;
      amountCents: number;
      termsDays: number;
      now: Date;
    }
  ): Promise<string> {
    const id = randomUUID();
    const dueAt = new Date(input.now);
    dueAt.setDate(dueAt.getDate() + input.termsDays);

    await trx
      .insertInto('customer_receivables')
      .values({
        id,
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        branch_id: input.branchId,
        sale_id: input.saleId,
        original_cents: input.amountCents,
        balance_cents: input.amountCents,
        status: 'OPEN',
        due_at: dueAt
      })
      .execute();

    return id;
  }

  /**
   * Anula los documentos de una venta anulada.
   *
   * No se borran: se marcan `VOID`. Que una venta a crédito se anuló y con ella su deuda es
   * información que el cliente puede necesitar ver, y borrarla dejaría un hueco inexplicable
   * en su estado de cuenta.
   */
  static async voidForSale(trx: Transaction<Database>, tenantId: string, saleId: string): Promise<void> {
    const pendientes = await trx
      .selectFrom('customer_receivables')
      .select(['id', 'original_cents', 'balance_cents'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', '=', saleId)
      .where('status', 'in', ['OPEN', 'PAID'])
      .execute();

    for (const documento of pendientes) {
      /**
       * Si ya le habían abonado algo, anular la venta dejaría un abono imputado a un
       * documento anulado. Se rechaza: primero hay que devolver ese dinero, y esa es una
       * decisión del comercio, no un efecto secundario de anular.
       */
      if (documento.balance_cents !== documento.original_cents) {
        throw new AppError(
          409,
          'RECEIVABLE_HAS_PAYMENTS',
          'No se puede anular una venta a crédito que ya tiene abonos. Devuelve el abono primero.'
        );
      }

      await trx
        .updateTable('customer_receivables')
        .set({ status: 'VOID', balance_cents: 0, updated_at: new Date() })
        .where('id', '=', documento.id)
        .execute();
    }
  }

  /**
   * Registra un abono y lo imputa a los documentos abiertos, del más antiguo al más nuevo.
   *
   * Imputar por antigüedad es como se cobra en la práctica: el cliente llega y dice «le
   * abono cincuenta», sin decir a cuál factura. Dejar el abono sin imputar sería más
   * «correcto» y absolutamente inútil — nadie sabría qué sigue debiendo.
   */
  static async registerPayment(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      customerId: string;
      branchId: string;
      cashSessionId?: string | null;
      methodCode: string;
      kind: PaymentKind;
      amountCents: number;
      reference?: string | null;
      notes?: string | null;
      userId: string;
      receivableId?: string | null;
    }
  ): Promise<{ paymentId: string; allocated: Array<{ receivableId: string; amountCents: number }>; unallocatedCents: number }> {
    if (input.kind === 'STORE_CREDIT') {
      throw new AppError(400, 'PAYMENT_METHOD_INVALID', 'Un abono no se puede pagar a crédito');
    }

    /**
     * Un abono en efectivo entra al cajón, así que tiene que quedar atado a un turno o el
     * arqueo de ese turno cuadrará de menos. Los demás medios no tocan el cajón y pueden
     * recibirse fuera de un turno abierto.
     */
    if (PAYMENT_KIND_BEHAVIOR[input.kind].affectsCashDrawer && !input.cashSessionId) {
      throw new AppError(
        400,
        'CASH_SESSION_REQUIRED',
        'Un abono en efectivo tiene que registrarse dentro de un turno de caja abierto'
      );
    }

    await this.lockCustomer(trx, input.tenantId, input.customerId);

    const abiertos = await trx
      .selectFrom('customer_receivables')
      .select(['id', 'balance_cents'])
      .where('tenant_id', '=', input.tenantId)
      .where('customer_id', '=', input.customerId)
      .where('status', '=', 'OPEN')
      .$if(Boolean(input.receivableId), (qb) => qb.where('id', '=', input.receivableId!))
      .orderBy('created_at', 'asc')
      .execute();

    const totalDeuda = abiertos.reduce((suma, documento) => suma + documento.balance_cents, 0);

    if (totalDeuda === 0) {
      throw new AppError(400, 'NO_OPEN_RECEIVABLES', 'Este cliente no tiene deuda pendiente que abonar');
    }

    /**
     * Cobrar de más no se acepta. Un saldo a favor es un concepto distinto —con sus reglas
     * de devolución y su tratamiento contable— y fingir que cabe aquí lo dejaría escondido
     * dentro de una cuenta por cobrar en negativo.
     */
    if (input.amountCents > totalDeuda) {
      throw new AppError(
        400,
        'PAYMENT_EXCEEDS_DEBT',
        `El abono supera la deuda pendiente del cliente (${Math.round(totalDeuda / 100)})`,
        { debt_cents: totalDeuda, amount_cents: input.amountCents }
      );
    }

    const paymentId = randomUUID();

    await trx
      .insertInto('customer_payments')
      .values({
        id: paymentId,
        tenant_id: input.tenantId,
        customer_id: input.customerId,
        branch_id: input.branchId,
        cash_session_id: input.cashSessionId ?? null,
        method_code: input.methodCode,
        kind: input.kind,
        amount_cents: input.amountCents,
        reference: input.reference ?? null,
        received_by_user_id: input.userId,
        notes: input.notes ?? null
      })
      .execute();

    let restante = input.amountCents;
    const allocated: Array<{ receivableId: string; amountCents: number }> = [];

    for (const documento of abiertos) {
      if (restante === 0) break;

      const imputado = Math.min(restante, documento.balance_cents);
      const nuevoSaldo = documento.balance_cents - imputado;

      await trx
        .insertInto('customer_payment_allocations')
        .values({
          id: randomUUID(),
          tenant_id: input.tenantId,
          payment_id: paymentId,
          receivable_id: documento.id,
          amount_cents: imputado
        })
        .execute();

      await trx
        .updateTable('customer_receivables')
        .set({
          balance_cents: nuevoSaldo,
          status: nuevoSaldo === 0 ? 'PAID' : 'OPEN',
          updated_at: new Date()
        })
        .where('id', '=', documento.id)
        .execute();

      allocated.push({ receivableId: documento.id, amountCents: imputado });
      restante -= imputado;
    }

    return { paymentId, allocated, unallocatedCents: restante };
  }

  static async upsertAccount(
    trx: Transaction<Database>,
    tenantId: string,
    customerId: string,
    input: UpsertCreditAccountInput
  ): Promise<void> {
    const cliente = await trx
      .selectFrom('customers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', customerId)
      .executeTakeFirst();

    if (!cliente) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'El cliente no existe');

    await trx
      .insertInto('customer_credit_accounts')
      .values({
        tenant_id: tenantId,
        customer_id: customerId,
        credit_limit_cents: input.credit_limit_cents,
        terms_days: input.terms_days,
        status: input.status,
        notes: input.notes ?? null
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'customer_id']).doUpdateSet({
          credit_limit_cents: input.credit_limit_cents,
          terms_days: input.terms_days,
          status: input.status,
          notes: input.notes ?? null,
          updated_at: new Date()
        })
      )
      .execute();
  }

  /** Estado de cuenta del cliente: cupo, documentos y abonos. */
  static async statement(
    trx: Transaction<Database>,
    tenantId: string,
    customerId: string,
    now: Date = new Date()
  ): Promise<CustomerStatement> {
    const cuenta = await trx
      .selectFrom('customer_credit_accounts as a')
      .innerJoin('customers as c', 'c.id', 'a.customer_id')
      .select(['a.credit_limit_cents', 'a.terms_days', 'a.status', 'a.notes', 'c.name'])
      .where('a.tenant_id', '=', tenantId)
      .where('a.customer_id', '=', customerId)
      .executeTakeFirst();

    if (!cuenta) throw new AppError(404, 'CREDIT_ACCOUNT_NOT_FOUND', 'Este cliente no tiene cupo configurado');

    const documentos = await trx
      .selectFrom('customer_receivables as r')
      .leftJoin('sales as s', 's.id', 'r.sale_id')
      .select([
        'r.id',
        'r.sale_id',
        'r.original_cents',
        'r.balance_cents',
        'r.status',
        'r.due_at',
        'r.created_at',
        's.sale_number'
      ])
      .where('r.tenant_id', '=', tenantId)
      .where('r.customer_id', '=', customerId)
      .orderBy('r.created_at', 'desc')
      .limit(200)
      .execute();

    const abonos = await trx
      .selectFrom('customer_payments')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', customerId)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();

    const imputaciones = abonos.length
      ? await trx
          .selectFrom('customer_payment_allocations')
          .select(['payment_id', 'receivable_id', 'amount_cents'])
          .where(
            'payment_id',
            'in',
            abonos.map((abono) => abono.id)
          )
          .execute()
      : [];

    const receivables: Receivable[] = documentos.map((documento) => ({
      id: documento.id,
      sale_id: documento.sale_id,
      // `pg` devuelve los enteros grandes como cadena; el contrato compartido dice número.
      sale_number: documento.sale_number === null ? null : Number(documento.sale_number),
      original_cents: documento.original_cents,
      balance_cents: documento.balance_cents,
      status: documento.status as ReceivableStatus,
      due_at: documento.due_at ? documento.due_at.toISOString() : null,
      overdue: documento.status === 'OPEN' && Boolean(documento.due_at && documento.due_at < now),
      created_at: documento.created_at.toISOString()
    }));

    const balance = receivables
      .filter((documento) => documento.status === 'OPEN')
      .reduce((suma, documento) => suma + documento.balance_cents, 0);

    const vencidos = receivables.filter((documento) => documento.overdue);

    const account: CreditAccount = {
      customer_id: customerId,
      customer_name: cuenta.name,
      credit_limit_cents: cuenta.credit_limit_cents,
      terms_days: cuenta.terms_days,
      status: cuenta.status as 'ACTIVE' | 'BLOCKED',
      balance_cents: balance,
      available_cents: availableCreditCents(cuenta.credit_limit_cents, balance),
      overdue_cents: vencidos.reduce((suma, documento) => suma + documento.balance_cents, 0),
      oldest_due_at: vencidos.length
        ? vencidos.map((documento) => documento.due_at!).sort()[0]!
        : null,
      notes: cuenta.notes
    };

    return {
      account,
      receivables,
      payments: abonos.map((abono) => ({
        id: abono.id,
        amount_cents: abono.amount_cents,
        method_code: abono.method_code,
        kind: abono.kind as PaymentKind,
        reference: abono.reference,
        notes: abono.notes,
        created_at: abono.created_at.toISOString(),
        allocations: imputaciones
          .filter((imputacion) => imputacion.payment_id === abono.id)
          .map((imputacion) => ({
            receivable_id: imputacion.receivable_id,
            amount_cents: imputacion.amount_cents
          }))
      }))
    };
  }
}
