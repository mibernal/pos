import { Kysely } from 'kysely';
import { Database } from '../../../shared/infra/db/schema.js';
import { Waiter, CreateWaiterPayload, UpdateWaiterPayload } from '@pos-dian/shared';
import { randomUUID } from 'crypto';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';
import { hashPassword, verifyPassword } from '../../identity/auth/password.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import type { EntitlementGuard } from '../../../shared/infra/entitlements/entitlement-guard.js';

/**
 * Columnas que salen hacia fuera. Nunca `pin_hash`: el `selectAll()` anterior era lo que
 * hacía que el PIN viajara en la respuesta de una ruta abierta a cualquier empleado.
 */
const PUBLIC_COLUMNS = [
  'id',
  'tenant_id',
  'branch_id',
  'user_id',
  'name',
  'is_active',
  'created_at',
  'updated_at'
] as const;

interface WaiterRow {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string | null;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  pin_hash?: string | null;
}

export class WaitersRepository {
  constructor(
    private db: Kysely<Database>,
    /**
     * La cuota de meseros del plan existía en el catálogo desde la fase 7 —clave, contador y
     * etiqueta— y no la comprobaba nadie: se podía dar de alta la plantilla entera con el
     * plan más barato. El guard tiene que correr **dentro** de la transacción que inserta,
     * porque el lock que serializa el conteo se suelta al terminarla.
     */
    private entitlementGuard: EntitlementGuard
  ) {}

  /**
   * La cuenta a la que se liga la ficha tiene que ser de este comercio.
   *
   * La clave foránea solo comprueba que el usuario exista, y las comprobaciones de clave
   * foránea no pasan por RLS: sin esto se podía ligar un mesero a un usuario de otro
   * comercio, y ese nombre acabaría apareciendo en el informe de meseros del ajeno.
   */
  private static async assertUserBelongsToTenant(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trx: any,
    tenantId: string,
    userId: string
  ): Promise<void> {
    const usuario = await trx
      .selectFrom('users')
      .select('id')
      .where('id', '=', userId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!usuario) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Esa cuenta no existe o no es de este comercio.');
    }
  }

  async listWaiters(tenantId: string, branchId: string): Promise<Waiter[]> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const records = await trx
        .selectFrom('waiters')
        .select([...PUBLIC_COLUMNS])
        .select((eb) => eb('pin_hash', 'is not', null).as('has_pin'))
        .where('tenant_id', '=', tenantId)
        .where('branch_id', '=', branchId)
        .where('is_active', '=', true)
        .execute();

      return records.map((row) => WaitersRepository.mapToEntity(row as WaiterRow, Boolean(row.has_pin)));
    });
  }

  async getWaiterById(tenantId: string, id: string): Promise<Waiter | null> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const record = await trx
        .selectFrom('waiters')
        .select([...PUBLIC_COLUMNS])
        .select((eb) => eb('pin_hash', 'is not', null).as('has_pin'))
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!record) return null;
      return WaitersRepository.mapToEntity(record as WaiterRow, Boolean(record.has_pin));
    });
  }

  async createWaiter(tenantId: string, branchId: string, payload: CreateWaiterPayload): Promise<Waiter> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      // La sucursal tiene que ser de este comercio. La política RLS comprueba `tenant_id`,
      // que lo pone el servidor — no la sucursal, que viene en la URL.
      const branch = await trx
        .selectFrom('branches')
        .select('id')
        .where('id', '=', branchId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!branch) {
        throw new AppError(404, 'BRANCH_NOT_FOUND', 'La sucursal no existe o no pertenece a este comercio');
      }

      // La validación va antes que la cuota: un dato mal puesto merece su propio error, y no
      // el genérico de «no te caben más meseros».
      if (payload.user_id) {
        await WaitersRepository.assertUserBelongsToTenant(trx, tenantId, payload.user_id);
      }

      await this.entitlementGuard.assertCanCreate(trx, tenantId, 'waiters');

      const pinHash = payload.pin ? await this.hashUniquePin(trx, tenantId, branchId, payload.pin, null) : null;

      const record = await trx
        .insertInto('waiters')
        .values({
          id: randomUUID(),
          tenant_id: tenantId,
          branch_id: branchId,
          name: payload.name,
          pin_hash: pinHash,
          user_id: payload.user_id ?? null,
          is_active: true
        })
        .returning([...PUBLIC_COLUMNS])
        .executeTakeFirstOrThrow();

      return WaitersRepository.mapToEntity(record as WaiterRow, pinHash !== null);
    });
  }

  async updateWaiter(tenantId: string, id: string, payload: UpdateWaiterPayload): Promise<Waiter> {
    return await executeAsTenant(this.db, tenantId, async (trx) => {
      const current = await trx
        .selectFrom('waiters')
        .select(['branch_id', 'pin_hash'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst();

      if (!current) {
        throw new AppError(404, 'WAITER_NOT_FOUND', 'El mesero no existe');
      }

      let query = trx.updateTable('waiters').where('tenant_id', '=', tenantId).where('id', '=', id);

      if (payload.name !== undefined) query = query.set('name', payload.name);
      if (payload.is_active !== undefined) query = query.set('is_active', payload.is_active);
      if (payload.user_id !== undefined) {
        if (payload.user_id) {
          await WaitersRepository.assertUserBelongsToTenant(trx, tenantId, payload.user_id);
        }
        query = query.set('user_id', payload.user_id);
      }

      let hasPin = current.pin_hash !== null;

      if (payload.pin !== undefined) {
        // `null` borra el PIN; un valor lo reemplaza. Omitirlo lo deja intacto — sin esto,
        // editar el nombre de un mesero le habría borrado el PIN.
        const pinHash = payload.pin === null
          ? null
          : await this.hashUniquePin(trx, tenantId, current.branch_id, payload.pin, id);

        query = query.set('pin_hash', pinHash);
        hasPin = pinHash !== null;
      }

      query = query.set('updated_at', new Date());

      const record = await query.returning([...PUBLIC_COLUMNS]).executeTakeFirstOrThrow();
      return WaitersRepository.mapToEntity(record as WaiterRow, hasPin);
    });
  }

  /**
   * Hashea el PIN y rechaza que dos meseros de la misma sucursal compartan uno.
   *
   * La unicidad no se puede imponer con un índice: Argon2 sala cada hash, así que dos PIN
   * iguales producen valores distintos. Se comprueba comparando contra los hashes de la
   * sucursal, que son pocos. Sin esta comprobación, dos meseros con el mismo PIN dejan la
   * atribución de ventas y propinas sin valor probatorio, que es para lo que existe.
   */
  private async hashUniquePin(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trx: any,
    tenantId: string,
    branchId: string,
    rawPin: string,
    excludeWaiterId: string | null
  ): Promise<string> {
    let existing = trx
      .selectFrom('waiters')
      .select(['id', 'pin_hash'])
      .where('tenant_id', '=', tenantId)
      .where('branch_id', '=', branchId)
      .where('is_active', '=', true)
      .where('pin_hash', 'is not', null);

    if (excludeWaiterId) {
      existing = existing.where('id', '!=', excludeWaiterId);
    }

    const rows: Array<{ id: string; pin_hash: string | null }> = await existing.execute();

    for (const row of rows) {
      if (row.pin_hash && (await verifyPassword(rawPin, row.pin_hash))) {
        throw new AppError(400, 'PIN_IN_USE', 'Ese PIN ya lo usa otro mesero de la sucursal. Elige uno distinto.');
      }
    }

    return await hashPassword(rawPin);
  }

  private static mapToEntity(row: WaiterRow, hasPin: boolean): Waiter {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      user_id: row.user_id,
      name: row.name,
      has_pin: hasPin,
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}
