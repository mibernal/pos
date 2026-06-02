import { describe, it, expect } from 'vitest';
import { envSchema } from '../src/config/env.js';

describe('Worker Environment Configuration', () => {
  it('parses valid development configuration', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DIAN_PROVIDER: 'mock',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DIAN_PROVIDER).toBe('mock');
    }
  });

  it('fails if DIAN_PROVIDER=mock in production', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DIAN_PROVIDER: 'mock',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'DIAN_PROVIDER=mock no está permitido en producción. Usar: http',
          path: ['DIAN_PROVIDER']
        })
      );
    }
  });

  it('fails if DIAN_PROVIDER=http and DIAN_HTTP_URL is missing', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DIAN_PROVIDER: 'http',
      DIAN_HTTP_API_KEY: '12345678', // valid length
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'DIAN_HTTP_URL es requerido cuando DIAN_PROVIDER=http',
          path: ['DIAN_HTTP_URL']
        })
      );
    }
  });

  it('fails if DIAN_PROVIDER=http and DIAN_HTTP_API_KEY is too short', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DIAN_PROVIDER: 'http',
      DIAN_HTTP_URL: 'https://api.provider.com/dian',
      DIAN_HTTP_API_KEY: 'short', // invalid length
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'DIAN_HTTP_API_KEY es requerido (mín. 8 caracteres) cuando DIAN_PROVIDER=http',
          path: ['DIAN_HTTP_API_KEY']
        })
      );
    }
  });

  it('parses valid production configuration with DIAN HTTP', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      DIAN_PROVIDER: 'http',
      DIAN_HTTP_URL: 'https://api.provider.com/dian',
      DIAN_HTTP_API_KEY: 'valid-api-key-here',
    });

    expect(result.success).toBe(true);
  });
});
