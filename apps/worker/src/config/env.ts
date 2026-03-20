import { z } from 'zod';

const envSchema = z
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
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().positive().default(3600000)
  })
  .superRefine((value, ctx) => {
    if (value.DIAN_PROVIDER === 'http' && !value.DIAN_HTTP_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DIAN_HTTP_URL es requerido cuando DIAN_PROVIDER=http',
        path: ['DIAN_HTTP_URL']
      });
    }
  });

export const env = envSchema.parse(process.env);
