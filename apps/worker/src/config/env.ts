import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://pos:pos@localhost:5432/pos_dian'),
    DIAN_PROVIDER: z.enum(['mock', 'http']).default('mock'),
    DIAN_HTTP_URL: z.string().url().optional(),
    DIAN_HTTP_API_KEY: z.string().min(1).optional(),
    DIAN_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().positive().default(30000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().positive().default(3600000),
    BILLING_MAX_RETRIES: z.coerce.number().int().default(3),
    BILLING_GRACE_PERIOD_DAYS: z.coerce.number().int().default(7),
    BILLING_TRIAL_DAYS: z.coerce.number().int().default(14),
    BILLING_SUSPENSION_AFTER_DAYS: z.coerce.number().int().default(30)
  })
  .superRefine((value, ctx) => {
    // C11: Bloquear DIAN_PROVIDER=mock en producción — riesgo fiscal crítico.
    // Simétrico con la validación existente en apps/api/src/app/env.ts.
    if (value.NODE_ENV === 'production' && value.DIAN_PROVIDER === 'mock') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DIAN_PROVIDER'],
        message: 'DIAN_PROVIDER=mock no está permitido en producción. Usar: http'
      });
    }

    if (value.DIAN_PROVIDER === 'http' && !value.DIAN_HTTP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DIAN_HTTP_URL es requerido cuando DIAN_PROVIDER=http',
        path: ['DIAN_HTTP_URL']
      });
    }

    // DIAN_HTTP_API_KEY es obligatorio cuando se usa el proveedor http.
    // Declararlo opcional en el schema base permite que el objeto se construya,
    // pero aquí forzamos su presencia para evitar requests no autenticadas a la DIAN.
    if (value.DIAN_PROVIDER === 'http' && (!value.DIAN_HTTP_API_KEY || value.DIAN_HTTP_API_KEY.trim().length < 8)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DIAN_HTTP_API_KEY es requerido (mín. 8 caracteres) cuando DIAN_PROVIDER=http',
        path: ['DIAN_HTTP_API_KEY']
      });
    }
  });

export const env = envSchema.parse(process.env);

