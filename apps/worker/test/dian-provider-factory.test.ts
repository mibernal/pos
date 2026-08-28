import { afterEach, describe, expect, it } from 'vitest';
import { buildDianProvider } from '../src/providers/index.js';
import { DianProviderMock } from '../src/providers/dian-provider-mock.js';
import { DianProviderSiigo } from '../src/providers/dian-provider-siigo.js';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('buildDianProvider', () => {
  it('permite el proveedor simulado fuera de producción', () => {
    process.env.NODE_ENV = 'test';
    expect(buildDianProvider({ provider_name: 'MOCK', credentials: {}, test_mode: true }))
      .toBeInstanceOf(DianProviderMock);
  });

  it('rechaza el proveedor simulado en producción', () => {
    process.env.NODE_ENV = 'production';
    expect(() => buildDianProvider({ provider_name: 'MOCK', credentials: {}, test_mode: false }))
      .toThrow(/simulado rechazado en producción/i);
  });

  it('rechaza en producción un provider_name desconocido en vez de caer al simulado', () => {
    process.env.NODE_ENV = 'production';
    expect(() => buildDianProvider({ provider_name: 'PAC_INVENTADO', credentials: {}, test_mode: false }))
      .toThrow(/simulado rechazado en producción/i);
  });

  it('rechaza en producción un tenant sin configuración DIAN', () => {
    process.env.NODE_ENV = 'production';
    expect(() => buildDianProvider()).toThrow(/simulado rechazado en producción/i);
  });

  it('construye un proveedor real sin importar el entorno', () => {
    process.env.NODE_ENV = 'production';
    expect(
      buildDianProvider({
        provider_name: 'SIIGO',
        credentials: { username: 'u', access_key: 'k' },
        test_mode: false
      })
    ).toBeInstanceOf(DianProviderSiigo);
  });
});
