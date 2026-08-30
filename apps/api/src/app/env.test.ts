import { describe, expect, it } from 'vitest';
import { envSchema, stripEmptyStrings } from './env.js';

/**
 * Guardas de configuración que solo aplican en producción.
 *
 * Un `JWT_SECRET` de 32 caracteres puede seguir siendo trivial: el marcador de posición del
 * repositorio cumple la longitud mínima y aun así lo conoce cualquiera que haya visto el
 * proyecto. Firmar con él las sesiones de todos los comercios equivale a no firmarlas.
 */

const productionBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://pos_api:x@db:5432/pos_dian',
  CORS_ALLOWED_ORIGINS: 'https://caja.ejemplo.co',
  DIAN_PROVIDER: 'http',
  RESEND_API_KEY: 're_test_key',
  JWT_SECRET: 'K7pQ2xR9vL4mN8wZ3bT6yH1jF5sD0gA2cE4uI7oP9kM'
};

function parse(overrides: Record<string, string>) {
  return envSchema.safeParse({ ...productionBase, ...overrides });
}

function issuePaths(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('Validación de entorno en producción', () => {
  it('acepta una configuración de producción completa', () => {
    expect(parse({}).success).toBe(true);
  });

  it('rechaza un JWT_SECRET que sea un marcador de posición, aunque cumpla la longitud', () => {
    const result = parse({ JWT_SECRET: 'replace-this-in-production-with-a-long-secret' });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('JWT_SECRET');
  });

  it('rechaza un JWT_SECRET largo pero de poca variedad', () => {
    // 40 caracteres, 2 distintos: pasa el `min(32)` y no vale nada.
    const result = parse({ JWT_SECRET: 'ababababababababababababababababababababab' });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('JWT_SECRET');
  });

  it('no aplica la regla de entropía fuera de producción', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      JWT_SECRET: 'replace-this-in-production-with-a-long-secret'
    });

    expect(result.success).toBe(true);
  });

  it('sigue bloqueando el proveedor DIAN simulado en producción', () => {
    const result = parse({ DIAN_PROVIDER: 'mock' });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('DIAN_PROVIDER');
  });

  it('exige que METRICS_TOKEN, si se define, tenga longitud suficiente', () => {
    expect(parse({ METRICS_TOKEN: 'corto' }).success).toBe(false);
    expect(parse({ METRICS_TOKEN: 'a4f9c1e7b2d8a3f6c0e5b9d2' }).success).toBe(true);
  });
});

describe('Variables vacías en el .env', () => {
  it('trata `FOO=` como ausente, no como cadena vacía', () => {
    // `.env.example` traía `METRICS_TOKEN=` y eso impedía arrancar la API y el worker: una
    // cadena vacía pasa el `.optional()` y luego revienta contra el `.min(16)`, con un
    // error que no menciona el `.env` por ninguna parte.
    const result = envSchema.safeParse(
      stripEmptyStrings({
        NODE_ENV: 'development',
        JWT_SECRET: 'K7pQ2xR9vL4mN8wZ3bT6yH1jF5sD0gA2cE4uI7oP9kM',
        METRICS_TOKEN: '',
        DIAN_HTTP_URL: '',
        ADMIN_DATABASE_URL: ''
      } as NodeJS.ProcessEnv)
    );

    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
    if (result.success) {
      expect(result.data.METRICS_TOKEN).toBeUndefined();
      expect(result.data.ADMIN_DATABASE_URL).toBeUndefined();
    }
  });

  it('un valor con solo espacios también cuenta como ausente', () => {
    const result = envSchema.safeParse(
      stripEmptyStrings({
        NODE_ENV: 'development',
        JWT_SECRET: 'K7pQ2xR9vL4mN8wZ3bT6yH1jF5sD0gA2cE4uI7oP9kM',
        METRICS_TOKEN: '   '
      } as NodeJS.ProcessEnv)
    );

    expect(result.success).toBe(true);
  });

  it('sigue rechazando un token corto pero real', () => {
    const result = envSchema.safeParse(
      stripEmptyStrings({
        NODE_ENV: 'development',
        JWT_SECRET: 'K7pQ2xR9vL4mN8wZ3bT6yH1jF5sD0gA2cE4uI7oP9kM',
        METRICS_TOKEN: 'corto'
      } as NodeJS.ProcessEnv)
    );

    expect(result.success).toBe(false);
  });
});
