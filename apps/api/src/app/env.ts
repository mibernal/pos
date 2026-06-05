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
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(2).default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().min(2).default('7d'),
  AUTH_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100).default(5),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().max(3_600_000).default(60_000),
  DIAN_PROVIDER: z.enum(['mock', 'http']).default('mock'),
  // C9: Ventana máxima configurable para anulación (default 24h en ms)
  SALE_VOID_MAX_AGE_HOURS: z.coerce.number().int().positive().max(720).default(24)
}).superRefine((value, ctx) => {


  if (value.NODE_ENV === 'production' && (!value.CORS_ALLOWED_ORIGINS || value.CORS_ALLOWED_ORIGINS.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ALLOWED_ORIGINS'],
      message: 'CORS_ALLOWED_ORIGINS es obligatorio en producción'
    });
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

export const env = envSchema.parse(process.env);
