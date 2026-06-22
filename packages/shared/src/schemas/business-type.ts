import { z } from 'zod';

// ─── Enum de tipos de negocio ─────────────────────────────────────────────────

export const BUSINESS_TYPE_VALUES = [
  'RESTAURANT',
  'CAFETERIA',
  'BAKERY',
  'FAST_FOOD',
  'BAR',
  'NIGHTCLUB',
  'BUTCHER',
  'MINIMARKET',
  'SUPERMARKET',
  'CORNER_STORE',
  'HARDWARE_STORE',
  'PHARMACY',
  'STATIONERY',
  'BOUTIQUE',
  'OTHER',
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_VALUES)[number];

export const businessTypeSchema = z.enum(BUSINESS_TYPE_VALUES);

// ─── Catálogo visual (labels en español + íconos) ────────────────────────────

export interface BusinessTypeMeta {
  value: BusinessType;
  label: string;
  icon: string;
}

export const BUSINESS_TYPE_CATALOG: BusinessTypeMeta[] = [
  { value: 'RESTAURANT',    label: 'Restaurante',     icon: '🍽️' },
  { value: 'CAFETERIA',     label: 'Cafetería',        icon: '☕' },
  { value: 'BAKERY',        label: 'Panadería',        icon: '🥐' },
  { value: 'FAST_FOOD',     label: 'Comidas Rápidas',  icon: '🍔' },
  { value: 'BAR',           label: 'Bar',              icon: '🍺' },
  { value: 'NIGHTCLUB',     label: 'Discoteca',        icon: '🎉' },
  { value: 'BUTCHER',       label: 'Carnicería',       icon: '🥩' },
  { value: 'MINIMARKET',    label: 'Minimercado',      icon: '🛒' },
  { value: 'SUPERMARKET',   label: 'Supermercado',     icon: '🏪' },
  { value: 'CORNER_STORE',  label: 'Tienda de Barrio', icon: '🏬' },
  { value: 'HARDWARE_STORE',label: 'Ferretería',       icon: '🔧' },
  { value: 'PHARMACY',      label: 'Droguería',        icon: '💊' },
  { value: 'STATIONERY',    label: 'Papelería',        icon: '📝' },
  { value: 'BOUTIQUE',      label: 'Boutique',         icon: '👗' },
  { value: 'OTHER',         label: 'Otro',             icon: '🏢' },
];

// ─── Tipos que son esencialmente restaurantes / servicio a mesa ───────────────

/** Business types that natively operate with table management. */
const TABLE_NATIVE_TYPES: ReadonlySet<BusinessType> = new Set([
  'RESTAURANT',
  'CAFETERIA',
  'BAKERY',
  'FAST_FOOD',
  'BAR',
  'NIGHTCLUB',
]);

// ─── Módulos del sistema ──────────────────────────────────────────────────────

export type BusinessModule =
  | 'tables'
  | 'delivery'
  | 'waiters'
  | 'split_bill'
  | 'tips'
  | 'kitchen'
  | 'kitchen_display'
  | 'kitchen_tickets'
  | 'kitchen_printing'
  | 'order_rounds'
  | 'product_modifiers'
  | 'reservations'
  | 'waiter_shifts'
  | 'qr_menu'
  | 'table_transfer'
  | 'pre_check';

/** All modules that compose the "restaurant experience". */
export const RESTAURANT_MODULES: BusinessModule[] = [
  'tables',
  'table_transfer',
  'delivery',
  'split_bill',
  'pre_check',
  'tips',
];

/**
 * Devuelve los módulos habilitados para un tipo de negocio.
 *
 * - Si el tipo es nativo de mesas (RESTAURANT, CAFETERIA, BAR, NIGHTCLUB) → todos los módulos de restaurante.
 * - Si el negocio es OTHER y `enableTables` es true → módulos de mesas habilitados manualmente.
 * - Cualquier otro tipo → sin módulos especiales.
 */
export function getEnabledModules(
  businessType: BusinessType,
  enableTables?: boolean
): BusinessModule[] {
  if (TABLE_NATIVE_TYPES.has(businessType)) {
    return [...RESTAURANT_MODULES];
  }
  if (businessType === 'OTHER' && enableTables) {
    return [...RESTAURANT_MODULES];
  }
  return [];
}

/**
 * Determina si un tipo de negocio requiere funcionalidad de mesas
 * de forma nativa (sin configuración adicional).
 */
export function isTableNativeType(businessType: BusinessType): boolean {
  return TABLE_NATIVE_TYPES.has(businessType);
}

// ─── Schemas compuestos ───────────────────────────────────────────────────────

/**
 * Schema para el campo business_type en el registro/creación de tenant.
 * Cuando el tipo es 'OTHER', se puede indicar:
 *  - `custom_business_type`: nombre libre del tipo de negocio
 *  - `enable_tables`: si requiere gestión de mesas
 */
export const businessTypeFieldSchema = z.object({
  business_type: businessTypeSchema,
  custom_business_type: z.string().trim().min(2).max(80).optional().nullable(),
  enable_tables: z.boolean().optional().default(false),
  enable_delivery: z.boolean().optional().default(false),
  enable_waiters: z.boolean().optional().default(false),
  enable_split_bill: z.boolean().optional().default(false),
  enable_tips: z.boolean().optional().default(false),
  enable_kitchen: z.boolean().optional().default(false),
  enable_kitchen_display: z.boolean().optional().default(false),
  enable_kitchen_tickets: z.boolean().optional().default(false),
  enable_kitchen_printing: z.boolean().optional().default(false),
  enable_order_rounds: z.boolean().optional().default(false),
  enable_product_modifiers: z.boolean().optional().default(false),
  enable_reservations: z.boolean().optional().default(false),
  enable_waiter_shifts: z.boolean().optional().default(false),
  enable_qr_menu: z.boolean().optional().default(false),
});

export type BusinessTypeField = z.infer<typeof businessTypeFieldSchema>;

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type BusinessTypeInput = z.infer<typeof businessTypeSchema>;
