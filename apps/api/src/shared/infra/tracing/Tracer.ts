import { trace, Span, SpanStatusCode, Attributes, SpanOptions } from '@opentelemetry/api';

export class TracerHelper {
  static getTracer(name: string) {
    return trace.getTracer(name);
  }

  /**
   * Ejecuta una función asíncrona dentro del contexto de un Span.
   * Cierra el span automáticamente y registra errores si ocurren.
   */
  static async withSpan<T>(
    tracerName: string,
    spanName: string,
    attributes: Attributes,
    fn: (span: Span) => Promise<T>
  ): Promise<T> {
    const tracer = this.getTracer(tracerName);
    const options: SpanOptions = { attributes };

    return tracer.startActiveSpan(spanName, options, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error: any) {
        this.setSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Helper para registrar un error en un span.
   */
  static setSpanError(span: Span, error: any) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error?.message || String(error)
    });
  }
}
