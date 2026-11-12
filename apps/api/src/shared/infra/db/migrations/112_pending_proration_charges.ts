import { Kysely, sql } from 'kysely';

/**
 * La diferencia de un cambio de plan deja de perderse: espera a la próxima factura.
 *
 * `/plan/preview` calculaba el prorrateo y se lo enseñaba al comercio —crédito por lo no
 * usado, cargo por la diferencia, nuevo fin de periodo— y `ChangeTenantPlanUseCase` no
 * aplicaba nada de eso: cambiaba `plan_id` y se iba. Lo que el cliente veía antes de
 * aceptar no era lo que pasaba después.
 *
 * Se cobra en la renovación siguiente, no en el acto. Mover dinero dentro de un cambio de
 * plan obliga a decidir qué pasa si el cobro falla **después** de haber cambiado el plan:
 * o se deja al comercio en un plan que no pagó, o se le revierte el plan por un problema de
 * tarjeta. Ninguna de las dos es buena, y las dos hay que construirlas. Como línea en la
 * próxima factura no hay estado intermedio que pueda quedarse a medias.
 *
 * `applied_invoice_id` es lo que impide cobrar dos veces: un cargo aplicado queda apuntado
 * a su factura y no vuelve a mirarse. Sin esa marca, un motor de cobro que corre cada hora
 * añadiría la misma línea en cada intento.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('subscription_pending_charges')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('tenant_id', 'uuid', (col) =>
      col.notNull().references('tenants.id').onDelete('cascade')
    )
    .addColumn('subscription_id', 'uuid', (col) =>
      col.notNull().references('tenant_subscriptions.id').onDelete('cascade')
    )
    .addColumn('description', 'varchar(255)', (col) => col.notNull())
    .addColumn('amount_cents', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`now()`).notNull())
    /** Nulo mientras espera; con factura, ya se cobró y no vuelve a entrar. */
    .addColumn('applied_invoice_id', 'uuid', (col) =>
      col.references('subscription_invoices.id').onDelete('set null')
    )
    .addCheckConstraint('ck_pending_charge_amount_positive', sql`amount_cents > 0`)
    .execute();

  // El motor de cobro solo pregunta por los pendientes de una suscripción: ese es el índice.
  await sql`
    CREATE INDEX idx_pending_charges_por_cobrar
    ON subscription_pending_charges (subscription_id)
    WHERE applied_invoice_id IS NULL
  `.execute(db);

  await sql`
    COMMENT ON TABLE subscription_pending_charges IS
    'Diferencias de prorrateo al cambiar de plan, a la espera de la próxima factura. applied_invoice_id marca las ya cobradas para que no entren dos veces.'
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('subscription_pending_charges').execute();
}
