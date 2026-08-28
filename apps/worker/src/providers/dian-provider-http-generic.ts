import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult,
  DianProviderResultStatus,
  DianProviderStatusQueryInput,
  DianProviderStatusQueryResult
} from './dian-provider.js';

interface DianProviderHttpGenericConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

function normalizeProviderStatus(value: unknown): DianProviderResultStatus | null {
  if (typeof value !== 'string') {
    return null;
  }

  const status = value.toUpperCase();
  if (status === 'SENT' || status === 'ACCEPTED' || status === 'REJECTED') {
    return status;
  }

  return null;
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
    // La numeración es obligatoria desde la fase 4: `sale.sale_number` es el contador
    // interno del comercio y no vale como número de factura electrónica. Sin ella el PAC
    // rechazaría el documento, o —peor— lo aceptaría con una numeración que la DIAN no
    // autorizó. Se falla aquí, antes de la llamada, para que el motivo sea legible.
    if (!input.numbering) {
      throw new Error(
        'DianProviderHttpGeneric: falta la numeración autorizada (prefijo y consecutivo de la resolución)'
      );
    }

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

      if (!status) {
        throw new Error(
          `DianProviderHttpGeneric invalid provider status: ${JSON.stringify(bodyRecord.status)}`
        );
      }

      if (status === 'ACCEPTED' && !cude) {
        throw new Error('DianProviderHttpGeneric accepted response missing CUDE');
      }

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

  /**
   * Consulta el estado de un documento ya enviado.
   *
   * La emisión es asíncrona: el PAC acusa recibo y resuelve después. Sin esto, un documento
   * puede quedarse en `SENT` para siempre. Un `UNKNOWN` significa «el proveedor no supo
   * decirlo ahora», que no es lo mismo que un rechazo: quien llama debe reintentar más
   * tarde, no dar el documento por perdido.
   */
  async queryStatus(input: DianProviderStatusQueryInput): Promise<DianProviderStatusQueryResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const query = new URLSearchParams();
    if (input.cude) query.set('cude', input.cude);
    if (input.prefix && input.document_number != null) {
      query.set('number', `${input.prefix}${input.document_number}`);
    }
    query.set('tenant_id', input.tenant_id);

    try {
      const response = await fetch(`${this.url.replace(/\/$/, '')}/status?${query.toString()}`, {
        method: 'GET',
        headers: this.apiKey ? { 'x-api-key': this.apiKey } : {},
        signal: controller.signal
      });

      let parsedBody: unknown = null;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = null;
      }

      const bodyRecord =
        typeof parsedBody === 'object' && parsedBody !== null
          ? (parsedBody as Record<string, unknown>)
          : {};

      if (!response.ok) {
        // Un error de consulta no dice nada sobre el documento: puede estar aceptado y ser
        // el endpoint el que falla. Se devuelve UNKNOWN en vez de inventar un estado.
        return {
          status: 'UNKNOWN',
          cude: null,
          raw: { provider: 'http-generic', statusCode: response.status, body: bodyRecord }
        };
      }

      const status = normalizeProviderStatus(bodyRecord.status);

      return {
        status: status ?? 'UNKNOWN',
        cude: extractCude(bodyRecord.cude ?? bodyRecord.CUDE ?? bodyRecord.uuid),
        raw: { provider: 'http-generic', statusCode: response.status, body: bodyRecord }
      };
    } catch (error) {
      return {
        status: 'UNKNOWN',
        cude: null,
        raw: { provider: 'http-generic', error: error instanceof Error ? error.message : String(error) }
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
