import type { DianProvider } from './dian-provider.js';
import { DianProviderMock } from './dian-provider-mock.js';
import { DianProviderHttpGeneric } from './dian-provider-http-generic.js';
import { DianProviderSiigo } from './dian-provider-siigo.js';

export interface TenantDianConfig {
  provider_name: string;
  credentials: Record<string, unknown>;
  test_mode: boolean;
}

/**
 * En producción, un proveedor simulado es un riesgo fiscal silencioso: el comercio
 * factura durante meses creyendo que emite y se entera en una revisión de la DIAN.
 * `env.ts` ya bloquea `DIAN_PROVIDER=mock` a nivel de entorno, pero la configuración
 * por tenant (migración 087) abría el mismo hueco por otra puerta —incluido un
 * `provider_name` desconocido, que caía al mock por defecto.
 *
 * Preferimos que el job falle y quede visible en las alertas de bandeja de salida
 * antes que emitir al vacío.
 */
function assertMockAllowed(reason: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Proveedor DIAN simulado rechazado en producción (${reason}). ` +
        'Configura un PAC real en tenant_dian_settings.provider_name.'
    );
  }
}

export function buildDianProvider(config?: TenantDianConfig): DianProvider {
  if (!config) {
    assertMockAllowed('el tenant no tiene configuración DIAN');
    return new DianProviderMock();
  }

  switch (config.provider_name) {
    case 'MOCK':
      assertMockAllowed("provider_name = 'MOCK'");
      return new DianProviderMock();
    case 'SIIGO':
      return new DianProviderSiigo(config.credentials, config.test_mode);
    case 'HTTP_GENERIC':
      return new DianProviderHttpGeneric({
        url: typeof config.credentials.url === 'string' ? config.credentials.url : '',
        apiKey: typeof config.credentials.apiKey === 'string' ? config.credentials.apiKey : undefined,
        timeoutMs: 15000
      });
    default:
      assertMockAllowed(`provider_name = '${config.provider_name}' no reconocido`);
      return new DianProviderMock();
  }
}
