import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../../../shared/infra/db/schema.js';
import { AppError } from '../../../shared/infra/errors/app-error.js';
import {
  DEFAULT_PAYMENT_METHODS,
  PAYMENT_KIND_BEHAVIOR,
  type PaymentKind,
  type PaymentMethodCatalogEntry,
  type UpsertPaymentMethodInput
} from '@pos-dian/shared';
import type { CatalogEntry } from '../services/payments.js';

type DbClient = Kysely<Database> | Transaction<Database>;

/**
 * El catálogo de medios de pago del comercio.
 *
 * Existe para que añadir «Nequi» sea una fila y no un despliegue. Lo que **no** es
 * configurable es el comportamiento del dinero: el tipo (`kind`) decide si toca el cajón y
 * si entra hoy, y eso viene del código. Un comercio puede llamar a su medio como quiera;
 * no puede declarar que un fiado entra en efectivo.
 */
export class PaymentMethodsRepository {
  /** Mapa por código, que es lo que consume la normalización de pagos. */
  static async loadCatalog(db: DbClient, tenantId: string): Promise<Map<string, CatalogEntry>> {
    const rows = await db
      .selectFrom('payment_method_catalog')
      .select(['code', 'kind', 'label', 'active', 'requires_reference'])
      .where('tenant_id', '=', tenantId)
      .execute();

    const catalog = new Map<string, CatalogEntry>();

    for (const row of rows) {
      catalog.set(row.code, {
        code: row.code,
        kind: row.kind as PaymentKind,
        label: row.label,
        active: row.active,
        requires_reference: row.requires_reference
      });
    }

    /**
     * Un comercio sin catálogo —creado antes de la 099 y aún no sembrado— cobra con los
     * medios por defecto en lugar de no poder cobrar. La caja no se detiene por un problema
     * de configuración nuestro.
     */
    if (catalog.size === 0) {
      for (const method of DEFAULT_PAYMENT_METHODS) {
        catalog.set(method.code, {
          code: method.code,
          kind: method.kind,
          label: method.label,
          active: method.active,
          requires_reference: PAYMENT_KIND_BEHAVIOR[method.kind].requiresReference
        });
      }
    }

    return catalog;
  }

  static async list(db: DbClient, tenantId: string): Promise<PaymentMethodCatalogEntry[]> {
    const rows = await db
      .selectFrom('payment_method_catalog')
      .select(['code', 'kind', 'label', 'active', 'requires_reference', 'sort_order', 'is_system'])
      .where('tenant_id', '=', tenantId)
      .orderBy('sort_order', 'asc')
      .orderBy('label', 'asc')
      .execute();

    return rows.map((row) => ({
      code: row.code,
      kind: row.kind as PaymentKind,
      label: row.label,
      active: row.active,
      requires_reference: row.requires_reference,
      sort_order: row.sort_order,
      is_system: row.is_system
    }));
  }

  /** Siembra los medios por defecto. Se llama al crear un comercio. */
  static async seedDefaults(trx: Transaction<Database>, tenantId: string): Promise<void> {
    await trx
      .insertInto('payment_method_catalog')
      .values(
        DEFAULT_PAYMENT_METHODS.map((method) => ({
          tenant_id: tenantId,
          code: method.code,
          kind: method.kind,
          label: method.label,
          active: method.active,
          requires_reference: PAYMENT_KIND_BEHAVIOR[method.kind].requiresReference,
          sort_order: method.sort_order,
          is_system: true
        }))
      )
      .onConflict((oc) => oc.columns(['tenant_id', 'code']).doNothing())
      .execute();
  }

  static async upsert(
    trx: Transaction<Database>,
    tenantId: string,
    input: UpsertPaymentMethodInput
  ): Promise<PaymentMethodCatalogEntry> {
    const existing = await trx
      .selectFrom('payment_method_catalog')
      .select(['code', 'kind', 'is_system'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', input.code)
      .executeTakeFirst();

    /**
     * El tipo de un medio ya existente no se puede cambiar. Convertir «Nequi» de billetera
     * a efectivo dejaría el catálogo contradiciendo los pagos ya guardados —cada uno lleva
     * su `kind` copiado— y, sobre todo, permitiría meter en el cajón dinero que nunca
     * estuvo ahí.
     */
    if (existing && existing.kind !== input.kind) {
      throw new AppError(
        400,
        'PAYMENT_METHOD_KIND_LOCKED',
        'No se puede cambiar el tipo de un medio de pago que ya existe. Crea uno nuevo y desactiva el anterior.'
      );
    }

    const requiresReference = input.requires_reference ?? PAYMENT_KIND_BEHAVIOR[input.kind].requiresReference;

    await trx
      .insertInto('payment_method_catalog')
      .values({
        tenant_id: tenantId,
        code: input.code,
        kind: input.kind,
        label: input.label,
        active: input.active,
        requires_reference: requiresReference,
        sort_order: input.sort_order,
        is_system: false
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'code']).doUpdateSet({
          label: input.label,
          active: input.active,
          requires_reference: requiresReference,
          sort_order: input.sort_order
        })
      )
      .execute();

    return {
      code: input.code,
      kind: input.kind,
      label: input.label,
      active: input.active,
      requires_reference: requiresReference,
      sort_order: input.sort_order,
      is_system: existing?.is_system ?? false
    };
  }

  /**
   * Apaga un medio. No se borra: hay ventas históricas que lo referencian, y un Z de hace
   * tres meses tiene que poder seguir nombrando con qué se cobró.
   */
  static async deactivate(trx: Transaction<Database>, tenantId: string, code: string): Promise<void> {
    const result = await trx
      .updateTable('payment_method_catalog')
      .set({ active: false })
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      throw new AppError(404, 'PAYMENT_METHOD_NOT_FOUND', 'El medio de pago no existe');
    }
  }
}
