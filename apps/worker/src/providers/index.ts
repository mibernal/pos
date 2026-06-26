import type { DianProvider } from './dian-provider.js';
import { DianProviderMock } from './dian-provider-mock.js';
import { DianProviderHttpGeneric } from './dian-provider-http-generic.js';
import { DianProviderSiigo } from './dian-provider-siigo.js';

export interface TenantDianConfig {
  provider_name: string;
  credentials: Record<string, unknown>;
  test_mode: boolean;
}

export function buildDianProvider(config?: TenantDianConfig): DianProvider {
  if (!config) {
    return new DianProviderMock();
  }
  
  switch (config.provider_name) {
    case 'MOCK':
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
      return new DianProviderMock();
  }
}
