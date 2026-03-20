import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult,
  DianProviderResultStatus
} from './dian-provider.js';

interface DianProviderHttpGenericConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

function normalizeProviderStatus(value: unknown): DianProviderResultStatus {
  if (typeof value !== 'string') {
    return 'ACCEPTED';
  }

  const status = value.toUpperCase();
  if (status === 'SENT' || status === 'ACCEPTED' || status === 'REJECTED') {
    return status;
  }

  return 'ACCEPTED';
}

function extractCude(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  return null;
}

export class DianProviderHttpGeneric implements DianProvider {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(config: DianProviderHttpGenericConfig) {
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
  }

  async emitSale(input: DianProviderEmitSaleInput): Promise<DianProviderEmitSaleResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { 'x-api-key': this.apiKey } : {})
        },
        body: JSON.stringify(input),
        signal: controller.signal
      });

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      if (!response.ok) {
        throw new Error(
          `DianProviderHttpGeneric error ${response.status}: ${JSON.stringify(parsedBody)}`
        );
      }

      const bodyRecord =
        typeof parsedBody === 'object' && parsedBody !== null
          ? (parsedBody as Record<string, unknown>)
          : {};

      const cude = extractCude(bodyRecord.cude ?? bodyRecord.CUDE ?? bodyRecord.uuid);
      const status = normalizeProviderStatus(bodyRecord.status);

      return {
        status,
        cude,
        raw: {
          provider: 'http-generic',
          statusCode: response.status,
          body: bodyRecord
        }
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`DianProviderHttpGeneric timeout after ${this.timeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
