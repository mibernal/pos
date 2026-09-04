import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  assertAndRecordIpRateLimit,
  assertAndRecordLoginAttempt,
  clearLoginRateLimit,
  LOGIN_RATE_LIMIT_EXCEEDED,
  RATE_LIMIT_EXCEEDED,
  resetLoginRateLimitStore
} from './login-rate-limit.js';

/**
 * Un Redis mudo no puede dejar al comercio sin caja.
 *
 * Esto no es una hipótesis: pasó. Redis aceptaba la conexión y no respondía —un contenedor
 * en pausa detrás del reenvío de puertos de Docker— y como el limitador de intentos corre
 * antes que nada en `/auth/login` y en `/auth/refresh`, la API se quedaba esperando un
 * comando que nunca volvía. El navegador se quedaba en «Validando sesión…» para siempre,
 * sin error, sin log y sin `/health` que lo delatara.
 *
 * Se arregló en tres capas —timeout de comando en el cliente, degradación a memoria aquí,
 * plazo en el navegador— y estas pruebas fijan la de en medio: la que decide qué pasa
 * cuando el contador compartido falla.
 */

/** Un Redis que falla como falla el de verdad: rechazando por tiempo agotado. */
function redisQueNoResponde(): Redis {
  return {
    eval: async () => {
      throw new Error('Command timed out');
    },
    del: async () => {
      throw new Error('Command timed out');
    }
  } as unknown as Redis;
}

function redisQueCuenta(valores: number[]): Redis {
  let i = 0;
  return {
    eval: async () => valores[Math.min(i++, valores.length - 1)],
    del: async () => 1
  } as unknown as Redis;
}

describe('el limitador de intentos cuando Redis no responde', () => {
  beforeEach(() => {
    resetLoginRateLimitStore();
  });

  it('deja entrar en vez de tumbar el login, y lo avisa por el log', async () => {
    const log = { warn: vi.fn() };

    await expect(
      assertAndRecordLoginAttempt(redisQueNoResponde(), 'ratelimit:global:1.2.3.4:ana@x.co', log)
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn.mock.calls[0]?.[1]).toMatch(/se cuenta en memoria/i);
  });

  it('sigue contando —en memoria— para no quedarse sin defensa alguna', async () => {
    const redis = redisQueNoResponde();
    const clave = 'ratelimit:refresh:1.2.3.4';

    // El máximo por IP del refresh son 30 por minuto; a la 31 tiene que cortar aunque el
    // contador compartido esté caído.
    for (let intento = 0; intento < 30; intento += 1) {
      await assertAndRecordIpRateLimit(redis, clave, 30, 60_000);
    }

    await expect(assertAndRecordIpRateLimit(redis, clave, 30, 60_000)).rejects.toThrow(
      RATE_LIMIT_EXCEEDED
    );
  });

  it('no confunde «Redis falló» con «te pasaste de intentos»', async () => {
    // El límite de verdad tiene que seguir propagándose: es la respuesta legítima del
    // limitador, no un fallo de infraestructura, y es lo que el 429 dice al usuario.
    const redis = redisQueCuenta([999]);

    await expect(assertAndRecordLoginAttempt(redis, 'ratelimit:global:1.2.3.4:ana@x.co')).rejects.toThrow(
      LOGIN_RATE_LIMIT_EXCEEDED
    );
  });

  it('un login válido no se cae porque no se pueda borrar el contador', async () => {
    const log = { warn: vi.fn() };

    // Se llama con las credenciales ya validadas: un fallo aquí no puede costarle la
    // sesión a quien acaba de escribir bien su contraseña.
    await expect(
      clearLoginRateLimit(redisQueNoResponde(), 'ratelimit:global:1.2.3.4:ana@x.co', log)
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('el contador en memoria se limpia también, para no arrastrar el castigo', async () => {
    const redis = redisQueNoResponde();
    const clave = 'ratelimit:refresh:9.9.9.9';

    await assertAndRecordIpRateLimit(redis, clave, 2, 60_000);
    await assertAndRecordIpRateLimit(redis, clave, 2, 60_000);
    await expect(assertAndRecordIpRateLimit(redis, clave, 2, 60_000)).rejects.toThrow(
      RATE_LIMIT_EXCEEDED
    );

    await clearLoginRateLimit(redis, clave);

    await expect(assertAndRecordIpRateLimit(redis, clave, 2, 60_000)).resolves.toBeUndefined();
  });
});
