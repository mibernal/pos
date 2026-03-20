import { env } from '../config/env.js';
import type { DianProvider } from './dian-provider.js';
import { DianProviderMock } from './dian-provider-mock.js';
import { DianProviderHttpGeneric } from './dian-provider-http-generic.js';

export function buildDianProvider(): DianProvider {
  switch (env.DIAN_PROVIDER) {
    case 'mock':
      return new DianProviderMock();
    case 'http':
      return new DianProviderHttpGeneric({
        url: env.DIAN_HTTP_URL!,
        apiKey: env.DIAN_HTTP_API_KEY,
        timeoutMs: env.DIAN_HTTP_TIMEOUT_MS
      });
    default:
      return new DianProviderMock();
  }
}
