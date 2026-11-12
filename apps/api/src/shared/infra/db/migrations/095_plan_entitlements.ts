import { Kysely, sql } from 'kysely';

/**
 * Migración 095 — El plan pasa a gobernar el producto.
 *
 * Hasta aquí, precio y capacidades eran dos sistemas que nadie sincronizaba:
 *
 *  - El plan llevaba un `features_json` con dos claves, `users` y `branches`, y esas eran
 *    las **únicas** cuotas que se comprobaban en todo el sistema.
 *  - Los módulos vivían en 21 columnas booleanas de `tenants` que un super-admin encendía a
 *    mano, sin relación con lo que el comercio pagaba.
 *
 * Vender un plan superior era, literalmente, editar la base de datos. Y como cada módulo
 * nuevo exigía una columna, un claim, una rama de `switch` y una línea de frontend, el
 * catálogo no podía crecer sin una migración.
 *
 * ### La migración no le quita nada a nadie
 *
 * Los planes reciben un conjunto de módulos razonable, pero los módulos de un comercio son
 * per-comercio, no per-plan: hay comercios con módulos encendidos que su plan no incluiría.
 * Apagárselos sería romperles el negocio para arreglar nuestro modelo. Así que **cada
 * módulo que un comercio tiene y su plan no incluye se convierte en una concesión
 * explícita** (`tenant_module_overrides` con `enabled = true` y motivo `MIGRACION_095`).
 * Después de esta migración cada comercio ve exactamente lo mismo que antes; lo que cambia
 * es que ahora está escrito de dónde viene cada permiso.
 *
 * Las 21 columnas de `tenants` se conservan como vista de compatibilidad y las sigue
 * escribiendo el resolutor. Se retirarán cuando nada las lea.
 */

const ASSIGNABLE_MODULES = [
  'restaurant', 'kds', 'inventory', 'fiscal', 'loyalty', 'advanced_reports',
  'tables', 'delivery', 'waiters', 'split_bill', 'tips', 'kitchen',
  'kitchen_display', 'kitchen_tickets', 'kitchen_printing', 'order_rounds',
  'product_modifiers', 'reservations', 'waiter_shifts', 'qr_menu', 'guests_count'
] as const;

const ENTITLEMENT_KEYS = [
  'users', 'branches', 'products', 'terminals', 'waiters', 'tables', 'monthly_sales'
] as const;

/** Módulos y límites de arranque para los tres planes sembrados por la 047. */
const PLAN_SEED: Record<string, { modules: string[]; limits: Record<string, number> }> = {
  STARTER: {
    modules: ['inventory'],
    limits: { users: 3, branches: 1, products: 500, terminals: 2, waiters: 0, tables: 0, monthly_sales: 1000 }
  },
  PRO: {
    modules: [
      'inventory', 'restaurant', 'tables', 'waiters', 'tips', 'split_bill',
      'kds', 'kitchen', 'kitchen_tickets', 'delivery', 'guests_count', 'advanced_reports'
    ],
    limits: { users: 10, branches: 3, products: 5000, terminals: 10, waiters: 20, tables: 40, monthly_sales: 10000 }
  },
  ENTERPRISE: {
    modules: [...ASSIGNABLE_MODULES],
    limits: { users: -1, branches: -1, products: -1, terminals: -1, waiters: -1, tables: -1, monthly_sales: -1 }
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  const moduleList = ASSIGNABLE_MODULES.map((m) => `'${m}'`).join(', ');
  const keyList = ENTITLEMENT_KEYS.map((k) => `'${k}'`).join(', ');

  // ── Qué da cada plan ────────────────────────────────────────────────────────
  await sql`
    CREATE TABLE plan_entitlements (
      plan_id       varchar(50)  NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
      entitlement_key varchar(50) NOT NULL,
      limit_value   integer      NOT NULL,
      updated_at    timestamp    NOT NULL DEFAULT now(),
      PRIMARY KEY (plan_id, entitlement_key),
      CONSTRAINT ck_plan_entitlements_key CHECK (entitlement_key IN (${sql.raw(keyList)})),
      CONSTRAINT ck_plan_entitlements_value CHECK (limit_value >= -1)
    )
  `.execute(db);

  await sql`
    CREATE TABLE plan_modules (
      plan_id  varchar(50) NOT NULL REFERENCES billing_plans(id) ON DELETE CASCADE,
      module   varchar(50) NOT NULL,
      PRIMARY KEY (plan_id, module),
      CONSTRAINT ck_plan_modules_module CHECK (module IN (${sql.raw(moduleList)}))
    )
  `.execute(db);

  // ── Excepciones comerciales, con motivo y caducidad ─────────────────────────
  // Un override sin motivo es un booleano suelto con otro nombre: dentro de seis meses
  // nadie sabe por qué ese comercio tiene ese módulo.
  await sql`
    CREATE TABLE tenant_module_overrides (
      tenant_id  uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module     varchar(50) NOT NULL,
      enabled    boolean     NOT NULL,
      reason     text        NOT NULL,
      expires_at timestamp,
      created_at timestamp   NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, module),
      CONSTRAINT ck_tenant_module_overrides_module CHECK (module IN (${sql.raw(moduleList)}))
    )
  `.execute(db);

  await sql`
    CREATE TABLE tenant_limit_overrides (
      tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      entitlement_key varchar(50) NOT NULL,
      limit_value     integer     NOT NULL,
      reason          text        NOT NULL,
      expires_at      timestamp,
      created_at      timestamp   NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, entitlement_key),
      CONSTRAINT ck_tenant_limit_overrides_key CHECK (entitlement_key IN (${sql.raw(keyList)})),
      CONSTRAINT ck_tenant_limit_overrides_value CHECK (limit_value >= -1)
    )
  `.execute(db);

  // ── Siembra de los planes del catálogo ──────────────────────────────────────
  for (const [planId, seed] of Object.entries(PLAN_SEED)) {
    const exists = await sql<{ id: string }>`SELECT id FROM billing_plans WHERE id = ${planId}`.execute(db);
    if (exists.rows.length === 0) continue;

    for (const [key, value] of Object.entries(seed.limits)) {
      await sql`
        INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value)
        VALUES (${planId}, ${key}, ${value})
        ON CONFLICT (plan_id, entitlement_key) DO NOTHING
      `.execute(db);
    }

    for (const module of seed.modules) {
      await sql`
        INSERT INTO plan_modules (plan_id, module)
        VALUES (${planId}, ${module})
        ON CONFLICT (plan_id, module) DO NOTHING
      `.execute(db);
    }
  }

  // Un plan creado a mano fuera del catálogo base se queda sin límites definidos. Sin una
  // fila, el resolutor no sabría si el plan es ilimitado o si nadie lo configuró: se
  // siembra ilimitado, que es el comportamiento que tenía antes (`?? -1`).
  for (const key of ENTITLEMENT_KEYS) {
    await sql`
      INSERT INTO plan_entitlements (plan_id, entitlement_key, limit_value)
      SELECT bp.id, ${key}, -1
      FROM billing_plans bp
      WHERE NOT EXISTS (
        SELECT 1 FROM plan_entitlements pe WHERE pe.plan_id = bp.id AND pe.entitlement_key = ${key}
      )
    `.execute(db);
  }

  // ── Nadie pierde un módulo que ya tenía ─────────────────────────────────────
  // Cada módulo encendido en el comercio que su plan no incluye pasa a ser una concesión
  // explícita. Los comercios sin suscripción también: se les respeta lo que tienen.
  for (const module of ASSIGNABLE_MODULES) {
    const column = `enable_${module}`;

    await sql`
      INSERT INTO tenant_module_overrides (tenant_id, module, enabled, reason)
      SELECT t.id, ${module}, true,
             'MIGRACION_095: el comercio ya tenía este módulo activo antes de que los planes lo gobernaran'
      FROM tenants t
      LEFT JOIN tenant_subscriptions ts
        ON ts.tenant_id = t.id AND ts.status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED')
      WHERE ${sql.raw(`t.${column}`)} = true
        AND NOT EXISTS (
          SELECT 1 FROM plan_modules pm WHERE pm.plan_id = ts.plan_id AND pm.module = ${module}
        )
      ON CONFLICT (tenant_id, module) DO NOTHING
    `.execute(db);
  }

  // Y si un comercio tiene un límite por debajo de lo que ya usa, no se le rompe nada: la
  // cuota se comprueba al crear, no sobre lo existente. Queda registrado para el informe de
  // uso, que es donde tiene que verse.

  await sql`CREATE INDEX idx_tenant_module_overrides_tenant ON tenant_module_overrides (tenant_id)`.execute(db);
  await sql`CREATE INDEX idx_tenant_limit_overrides_tenant ON tenant_limit_overrides (tenant_id)`.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS tenant_limit_overrides`.execute(db);
  await sql`DROP TABLE IF EXISTS tenant_module_overrides`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_modules`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_entitlements`.execute(db);
}
