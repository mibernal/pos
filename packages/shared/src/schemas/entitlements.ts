import { z } from 'zod';
import type { BusinessModule } from './business-type.js';

/**
 * Lo que un plan da derecho a hacer.
 *
 * Hasta la fase 7 el precio y el producto eran dos sistemas que nadie sincronizaba: el plan
 * llevaba un `features_json` con dos claves (`users`, `branches`) y los módulos vivían en 21
 * columnas booleanas de `tenants` que un super-admin encendía a mano. Vender un plan
 * superior era una operación de base de datos, no de catálogo.
 *
 * Aquí se define el contrato único: qué se puede limitar y qué módulos existen. El plan
 * declara ambos; un comercio puede tener excepciones comerciales, y esas son explícitas y
 * auditables en vez de un booleano suelto.
 */

// ─── Límites ──────────────────────────────────────────────────────────────────

/**
 * Dimensiones limitables. Se cuentan sobre el estado actual del comercio, salvo
 * `monthly_sales`, que es un acumulado del mes.
 */
export const ENTITLEMENT_KEYS = [
  'users',
  'branches',
  'products',
  'terminals',
  'waiters',
  'tables',
  'monthly_sales'
] as const;

export const entitlementKeySchema = z.enum(ENTITLEMENT_KEYS);
export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

/** `-1` es ilimitado. Cualquier otro valor negativo no significa nada y se rechaza. */
export const UNLIMITED = -1;

export const limitValueSchema = z
  .number()
  .int()
  .min(-1, 'Un límite es -1 (ilimitado) o un entero no negativo');

/**
 * `monthly_sales` se **mide pero no se bloquea**.
 *
 * Cortar la facturación de un comercio porque superó su cupo mensual es apagarle la caja a
 * mitad de servicio, y eso no se hace nunca: el principio de toda la ruta es que la caja
 * sigue vendiendo aunque el resto se degrade. El límite existe para avisar y para ofrecer
 * el plan siguiente, no para frenar una venta.
 */
export const MEASURED_ONLY_KEYS: readonly EntitlementKey[] = ['monthly_sales'];

export function isEnforceable(key: EntitlementKey): boolean {
  return !MEASURED_ONLY_KEYS.includes(key);
}

export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  users: 'Usuarios',
  branches: 'Sucursales',
  products: 'Productos',
  terminals: 'Terminales',
  waiters: 'Meseros',
  tables: 'Mesas',
  monthly_sales: 'Ventas al mes'
};

// ─── Módulos ──────────────────────────────────────────────────────────────────

/**
 * Módulos que se pueden incluir en un plan o conceder a un comercio.
 *
 * `table_transfer` y `pre_check` quedan fuera a propósito: no son módulos con estado
 * propio, son alias de `tables` que el guard resuelve. Guardarlos sería inventar un dato
 * que nadie mantiene.
 */
export const ASSIGNABLE_MODULES = [
  'restaurant',
  'kds',
  'inventory',
  'fiscal',
  'loyalty',
  'advanced_reports',
  'tables',
  'delivery',
  'waiters',
  'split_bill',
  'tips',
  'kitchen',
  'kitchen_display',
  'kitchen_tickets',
  'kitchen_printing',
  'order_rounds',
  'product_modifiers',
  'reservations',
  'waiter_shifts',
  'qr_menu',
  'guests_count'
] as const satisfies readonly BusinessModule[];

export const assignableModuleSchema = z.enum(ASSIGNABLE_MODULES);
export type AssignableModule = (typeof ASSIGNABLE_MODULES)[number];

/** Columna de `tenants` que corresponde a cada módulo, para la vista de compatibilidad. */
export const MODULE_COLUMN: Record<AssignableModule, string> = {
  restaurant: 'enable_restaurant',
  kds: 'enable_kds',
  inventory: 'enable_inventory',
  fiscal: 'enable_fiscal',
  loyalty: 'enable_loyalty',
  advanced_reports: 'enable_advanced_reports',
  tables: 'enable_tables',
  delivery: 'enable_delivery',
  waiters: 'enable_waiters',
  split_bill: 'enable_split_bill',
  tips: 'enable_tips',
  kitchen: 'enable_kitchen',
  kitchen_display: 'enable_kitchen_display',
  kitchen_tickets: 'enable_kitchen_tickets',
  kitchen_printing: 'enable_kitchen_printing',
  order_rounds: 'enable_order_rounds',
  product_modifiers: 'enable_product_modifiers',
  reservations: 'enable_reservations',
  waiter_shifts: 'enable_waiter_shifts',
  qr_menu: 'enable_qr_menu',
  guests_count: 'enable_guests_count'
};

// ─── Nivel de servicio ────────────────────────────────────────────────────────

/**
 * Cuánto producto ve un comercio según el estado de su suscripción.
 *
 * - `FULL`      — TRIAL y ACTIVE. Todo.
 * - `DEGRADED`  — PAST_DUE, dentro del periodo de gracia. **La caja sigue funcionando**:
 *                 vender, cobrar, abrir y cerrar turno, cocina y mesas. Lo que se apaga es
 *                 el backoffice: informes, catálogo, usuarios, sucursales y configuración.
 *                 Un comercio en mora tiene que poder seguir atendiendo a su gente.
 * - `BLOCKED`   — SUSPENDED, CANCELLED o sin suscripción. No entra.
 */
export const SERVICE_LEVELS = ['FULL', 'DEGRADED', 'BLOCKED'] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

// ─── Formas de la API ─────────────────────────────────────────────────────────

export const planEntitlementsSchema = z.object({
  limits: z.record(entitlementKeySchema, limitValueSchema),
  modules: z.array(assignableModuleSchema)
});

export type PlanEntitlements = z.infer<typeof planEntitlementsSchema>;

export const tenantUsageSchema = z.object({
  key: entitlementKeySchema,
  label: z.string(),
  used: z.number().int().nonnegative(),
  limit: z.number().int(),
  enforced: z.boolean()
});

export type TenantUsage = z.infer<typeof tenantUsageSchema>;

export const resolvedEntitlementsSchema = z.object({
  tenant_id: z.string().uuid(),
  plan_id: z.string().nullable(),
  subscription_status: z.string().nullable(),
  service_level: z.enum(SERVICE_LEVELS),
  modules: z.array(assignableModuleSchema),
  limits: z.record(entitlementKeySchema, limitValueSchema)
});

export type ResolvedEntitlements = z.infer<typeof resolvedEntitlementsSchema>;

/** Qué cambiaría al mover un comercio de plan, para poder enseñarlo antes de confirmar. */
export const planChangePreviewSchema = z.object({
  current_plan_id: z.string().nullable(),
  target_plan_id: z.string(),
  direction: z.enum(['UPGRADE', 'DOWNGRADE', 'SAME_PRICE']),
  modules_gained: z.array(assignableModuleSchema),
  modules_lost: z.array(assignableModuleSchema),
  limits_over_quota: z.array(
    z.object({
      key: entitlementKeySchema,
      label: z.string(),
      used: z.number().int(),
      new_limit: z.number().int()
    })
  ),
  proration: z.object({
    unused_days: z.number().int().nonnegative(),
    credit_cents: z.number().int().nonnegative(),
    charge_cents: z.number().int().nonnegative(),
    days_granted: z.number().int(),
    new_period_end: z.string()
  })
});

export type PlanChangePreview = z.infer<typeof planChangePreviewSchema>;
