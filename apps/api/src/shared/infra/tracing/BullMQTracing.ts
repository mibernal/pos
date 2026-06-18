import { propagation, context, trace } from '@opentelemetry/api';
import { Job } from 'bullmq';

/**
 * BullMQ Tracing Helper
 * 
 * OpenTelemetry automatically instruments BullMQ via auto-instrumentations-node
 * but sometimes for deeply nested jobs or manual queue additions, you want to
 * ensure context is explicitly propagated in the job data.
 */
export class BullMQTracing {
  /**
   * Inyecta el contexto de traza activo dentro del payload de un job.
   */
  static injectTraceContext(jobData: any = {}): any {
    const carrier = {};
    propagation.inject(context.active(), carrier);
    return {
      ...jobData,
      _trace_context: carrier
    };
  }

  /**
   * Restaura el contexto a partir del payload del job y ejecuta una función.
   * Útil si el auto-instrumentation falla al enlazar el job processor.
   */
  static withJobContext<T>(job: Job, tracerName: string, spanName: string, fn: () => Promise<T>): Promise<T> {
    const carrier = job.data?._trace_context || {};
    const parentContext = propagation.extract(context.active(), carrier);
    
    const tracer = trace.getTracer(tracerName);
    return context.with(parentContext, () => {
      return tracer.startActiveSpan(spanName, async (span) => {
        try {
          span.setAttribute('job.name', job.name);
          span.setAttribute('job.id', job.id || 'unknown');
          
          const result = await fn();
          span.setStatus({ code: 1 }); // OK
          return result;
        } catch (error: any) {
          span.recordException(error);
          span.setStatus({ code: 2, message: error.message }); // ERROR
          throw error;
        } finally {
          span.end();
        }
      });
    });
  }
}
