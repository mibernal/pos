import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { Database } from '../../../../shared/infra/db/schema.js';
import { AppError } from '../../../../shared/infra/errors/app-error.js';
import { recurringGateway, type RecurringGatewayName } from '../../domain/recurring-gateway.js';
import type { PaymentMethod } from '@pos-dian/shared';

/**
 * Columnas que salen hacia el comercio. `gateway_token` no está en la lista, y no por
 * descuido: es la referencia con la que se cobra, y no tiene por qué viajar al navegador
 * ni aparecer en un log de respuestas. Es la misma disciplina que `PUBLIC_COLUMNS` en el
 * repositorio de meseros, donde el `pin_hash` se quedó fuera por la misma razón.
 */
const PUBLIC_COLUMNS = [
  'id',
  'gateway',
  'brand',
  'last_four',
  'exp_month',
  'exp_year',
  'holder_name',
  'status',
  'is_default',
  'created_at'
] as const;

function toPublic(row: Record<string, unknown>): PaymentMethod {
  return {
    id: row.id as string,
    gateway: row.gateway as string,
    brand: (row.brand as string) ?? null,
    last_four: (row.last_four as string) ?? null,
    exp_month: (row.exp_month as number) ?? null,
    exp_year: (row.exp_year as number) ?? null,
    holder_name: (row.holder_name as string) ?? null,
    status: row.status as PaymentMethod['status'],
    is_default: Boolean(row.is_default),
    created_at: (row.created_at as Date).toISOString()
  };
}

export class PaymentMethodsService {
  /**
   * Registra la tarjeta como medio de pago del comercio.
   *
   * El orden importa: primero se tokeniza contra la pasarela y solo después se escribe. Al
   * revés quedaría una fila apuntando a una fuente de pago que no existe, y el primer cobro
   * automático fallaría sin que nadie supiera por qué.
   */
  static async register(
    trx: Transaction<Database>,
    input: {
      tenantId: string;
      gateway: RecurringGatewayName;
      cardToken: string;
      acceptanceToken: string;
      customerEmail: string;
      makeDefault: boolean;
    }
  ): Promise<PaymentMethod> {
    const adapter = recurringGateway(input.gateway);

    const tokenized = await adapter.tokenizePaymentMethod!({
      cardToken: input.cardToken,
      acceptanceToken: input.acceptanceToken,
      customerEmail: input.customerEmail
    });

    const id = randomUUID();

    if (input.makeDefault) {
      // El índice único deja un solo método por defecto y por comercio, así que el anterior
      // se baja antes de subir el nuevo.
      await trx
        .updateTable('tenant_payment_methods')
        .set({ is_default: false, updated_at: new Date() })
        .where('tenant_id', '=', input.tenantId)
        .where('is_default', '=', true)
        .execute();
    }

    await trx
      .insertInto('tenant_payment_methods')
      .values({
        id,
        tenant_id: input.tenantId,
        gateway: input.gateway,
        gateway_token: tokenized.gatewayToken,
        brand: tokenized.brand ?? null,
        last_four: tokenized.lastFour ?? null,
        exp_month: tokenized.expMonth ?? null,
        exp_year: tokenized.expYear ?? null,
        holder_name: tokenized.holderName ?? null,
        status: 'ACTIVE',
        is_default: input.makeDefault,
        metadata_json: null
      })
      .execute();

    if (input.makeDefault) {
      /**
       * Registrar la tarjeta enciende la renovación automática y despeja la cobranza: si el
       * comercio estaba en mora precisamente por no tener medio de pago, dejarlo en mora
       * con la tarjeta ya puesta sería absurdo. El cobro pendiente lo intenta el motor en
       * su siguiente pasada, que es cuestión de minutos.
       */
      await trx
        .updateTable('tenant_subscriptions')
        .set({
          payment_method_id: id,
          payment_method_token: tokenized.gatewayToken,
          auto_renew: true,
          next_retry_at: new Date(),
          updated_at: new Date()
        })
        .where('tenant_id', '=', input.tenantId)
        .where('status', 'in', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
        .execute();
    }

    const row = await trx
      .selectFrom('tenant_payment_methods')
      .select(PUBLIC_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    return toPublic(row);
  }

  static async list(trx: Transaction<Database>, tenantId: string): Promise<PaymentMethod[]> {
    const rows = await trx
      .selectFrom('tenant_payment_methods')
      .select(PUBLIC_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .where('status', '!=', 'REMOVED')
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc')
      .execute();

    return rows.map(toPublic);
  }

  static async findDefault(trx: Transaction<Database>, tenantId: string) {
    return trx
      .selectFrom('tenant_payment_methods')
      .select(['id', 'gateway', 'gateway_token', 'brand', 'last_four'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'ACTIVE')
      .where('is_default', '=', true)
      .executeTakeFirst();
  }

  /**
   * Retira un medio de pago. No se borra la fila: la factura cobrada el mes pasado tiene
   * que poder decir con qué tarjeta se pagó, aunque el comercio ya la haya quitado.
   */
  static async remove(trx: Transaction<Database>, tenantId: string, id: string): Promise<void> {
    const method = await trx
      .selectFrom('tenant_payment_methods')
      .select(['id', 'is_default'])
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!method) {
      throw new AppError(404, 'PAYMENT_METHOD_NOT_FOUND', 'El medio de pago no existe');
    }

    await trx
      .updateTable('tenant_payment_methods')
      .set({ status: 'REMOVED', is_default: false, updated_at: new Date() })
      .where('id', '=', id)
      .execute();

    if (method.is_default) {
      // Sin medio de pago no hay cobro automático que valga: se apaga y se le avisa al
      // comercio, en lugar de dejar una renovación que va a fallar sola dentro de un mes.
      await trx
        .updateTable('tenant_subscriptions')
        .set({ payment_method_id: null, payment_method_token: null, auto_renew: false, updated_at: new Date() })
        .where('tenant_id', '=', tenantId)
        .where('payment_method_id', '=', id)
        .execute();
    }
  }

  /**
   * Marca como vencidas las tarjetas cuya fecha de expiración ya pasó, para que el portal
   * lo diga antes de que lo diga un cobro rechazado.
   */
  static async expireStale(trx: Transaction<Database>, tenantId: string, now: Date): Promise<number> {
    const result = await trx
      .updateTable('tenant_payment_methods')
      .set({ status: 'EXPIRED', updated_at: now })
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'ACTIVE')
      .where('exp_year', 'is not', null)
      .where('exp_month', 'is not', null)
      .where(
        sql<boolean>`make_date(exp_year, exp_month, 1) + interval '1 month' <= ${now}`
      )
      .executeTakeFirst();

    return Number(result.numUpdatedRows);
  }
}
