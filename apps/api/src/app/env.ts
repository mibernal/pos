import { z } from 'zod';


const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://pos:pos@localhost:5432/pos_dian'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Rol dueño del esquema. Lo usan migraciones y semillas, que hacen DDL y siembran filas
  // de varios comercios: operaciones que el rol restringido de la API no puede —ni debe—
  // realizar. Si no se define, se cae a DATABASE_URL (entorno de desarrollo simple).
  ADMIN_DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(2).default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(2).default('7d'),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100).default(5),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  DIAN_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  // C9: Ventana máxima configurable para anulación (default 24h en ms)
  SALE_VOID_MAX_AGE_HOURS: z.coerce.number().int().positive().max(720).default(24),
  WOMPI_PUBLIC_KEY: z.string().optional(),
  WOMPI_EVENTS_KEY: z.string().optional(),
  // Llave privada de Wompi. Solo se usa server-to-server: es la que autoriza a cobrar sobre
  // una fuente de pago guardada, sin el tarjetahabiente delante. Nunca sale al frontend.
  WOMPI_PRIVATE_KEY: z.string().optional(),
  WOMPI_API_URL: z.string().url().default('https://production.wompi.co/v1'),
  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  
  // Notification Service variables
  RESEND_API_KEY: z.string().optional(),
  NOTIFICATION_PROVIDER: z.enum(['RESEND', 'SENDGRID']).default('RESEND'),
  
  // Billing Renewal Engine variables
  BILLING_MAX_RETRIES: z.coerce.number().int().default(3),
  BILLING_GRACE_PERIOD_DAYS: z.coerce.number().int().default(7),
  BILLING_TRIAL_DAYS: z.coerce.number().int().default(14),
  BILLING_SUSPENSION_AFTER_DAYS: z.coerce.number().int().default(30),
  // Pasarela con la que se cobra solo. Las demás quedan como pago manual por checkout:
  // solo Wompi expone fuentes de pago reutilizables en Colombia.
  BILLING_RECURRING_GATEWAY: z.enum(['WOMPI', 'MOCK']).default('WOMPI'),
  // IVA sobre el servicio, desglosado en la factura. 0.19 en Colombia.
  BILLING_TAX_RATE: z.coerce.number().min(0).max(1).default(0.19),
  BILLING_INVOICE_PREFIX: z.string().min(1).max(10).default('POS'),
  // Días de plazo de la factura antes de considerarla vencida.
  BILLING_INVOICE_DUE_DAYS: z.coerce.number().int().nonnegative().default(3),
  // Descuento del ciclo anual, en porcentaje sobre doce mensualidades.
  BILLING_YEARLY_DISCOUNT_PERCENT: z.coerce.number().min(0).max(90).default(15),
  // A dónde manda el correo de cobranza. Sin esto los avisos dicen qué pasó pero no dónde
  // arreglarlo, que es la mitad del trabajo.
  BILLING_PORTAL_URL: z.string().url().optional(),

  // Platform Admin Cache TTLs
  CACHE_DASHBOARD_METRICS_TTL_S: z.coerce.number().int().nonnegative().default(120),
  CACHE_GROWTH_METRICS_TTL_S: z.coerce.number().int().nonnegative().default(600),
  CACHE_BILLING_METRICS_TTL_S: z.coerce.number().int().nonnegative().default(300),

  // Token para `/metrics`. Sin él, el endpoint queda cerrado en producción: las métricas
  // de Prometheus incluyen rutas, latencias y volumen por endpoint, que es reconocimiento
  // gratuito para cualquiera que encuentre el puerto abierto.
  METRICS_TOKEN: z.string().min(16).optional()
}).superRefine((value, ctx) => {

  if (value.NODE_ENV === 'production' && value.NOTIFICATION_PROVIDER === 'RESEND' && !value.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY es obligatorio en producción si se usa RESEND'
    });
  }

  if (value.NODE_ENV === 'production' && (!value.CORS_ALLOWED_ORIGINS || value.CORS_ALLOWED_ORIGINS.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ALLOWED_ORIGINS'],
      message: 'CORS_ALLOWED_ORIGINS es obligatorio en producción'
    });
  }

  // Un `JWT_SECRET` de 32 caracteres puede seguir siendo trivial: el marcador de posición
  // del repositorio los tiene, y aun así lo conoce cualquiera que haya visto el proyecto.
  // Firmar los tokens de sesión de todos los comercios con él equivale a no firmarlos.
  if (value.NODE_ENV === 'production') {
    const secret = value.JWT_SECRET;
    const distinctChars = new Set(secret).size;
    const looksLikePlaceholder = /replace|change|example|secret-?key|placeholder|your-|test|demo|default/i.test(secret);

    if (looksLikePlaceholder) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'JWT_SECRET parece un valor de ejemplo. Genera uno real: openssl rand -base64 48'
      });
    } else if (distinctChars < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          `JWT_SECRET tiene muy poca variedad (${distinctChars} caracteres distintos). ` +
          'Genera uno real: openssl rand -base64 48'
      });
    }
  }

  // C11: Bloquear DIAN_PROVIDER=mock en producción — riesgo fiscal crítico
  if (value.NODE_ENV === 'production' && value.DIAN_PROVIDER === 'mock') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DIAN_PROVIDER'],
      message: 'DIAN_PROVIDER=mock no está permitido en producción. Usar: http'
    });
  }
});


/**
 * En un archivo `.env`, `FOO=` significa «sin configurar», no «cadena vacía». Pero para
 * Node es una cadena vacía, que **no** es `undefined`: una variable declarada como
 * `z.string().min(16).optional()` pasa el `optional()` y revienta contra el `min(16)`.
 *
 * Pasó de verdad: `.env.example` traía `METRICS_TOKEN=` y eso impedía arrancar la API y el
 * worker con un error que no decía nada del `.env`. Aquí se normaliza antes de validar.
 */
function stripEmptyStrings(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    cleaned[key] = typeof value === 'string' && value.trim() === '' ? undefined : value;
  }
  return cleaned;
}

/**
 * Se exporta para poder probar las reglas de producción sin arrancar el proceso con esas
 * variables. `env` sigue siendo el objeto ya validado que usa el resto de la aplicación.
 */
export { envSchema, stripEmptyStrings };

export const env = envSchema.parse(stripEmptyStrings(process.env));
