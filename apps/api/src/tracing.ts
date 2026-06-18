import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions';
import { propagation, metrics } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PeriodicExportingMetricReader, MeterProvider } from '@opentelemetry/sdk-metrics';

// Set up W3C Trace Context propagator
propagation.setGlobalPropagator(new W3CTraceContextPropagator());

const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'pos-dian-api',
  [ATTR_SERVICE_VERSION]: '0.1.0',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
});

const traceExporter = new OTLPTraceExporter({
  url: process.env.OTLP_TRACE_ENDPOINT || 'http://localhost:4318/v1/traces',
});

const metricExporter = new OTLPMetricExporter({
  url: process.env.OTLP_METRICS_ENDPOINT || 'http://localhost:4318/v1/metrics',
});

const meterProvider = new MeterProvider({ resource });
meterProvider.addMetricReader(
  new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 10000, // Export every 10 seconds
  })
);
metrics.setGlobalMeterProvider(meterProvider);

// Custom Meters for POS Business Metrics
export const posMeter = metrics.getMeter('pos-metrics-meter');

// Define specific metrics requested
export const salesCounter = posMeter.createCounter('pos.sales.count', {
  description: 'Number of sales processed',
});

export const apiLatencyHistogram = posMeter.createHistogram('pos.api.latency', {
  description: 'API response latency',
  unit: 'ms',
});

export const apiErrorsCounter = posMeter.createCounter('pos.api.errors', {
  description: 'API errors by endpoint',
});

export const dbLatencyHistogram = posMeter.createHistogram('pos.db.latency', {
  description: 'Database query response time',
  unit: 'ms',
});

export const outboxPendingGauge = posMeter.createObservableGauge('pos.outbox.pending', {
  description: 'Pending outbox events to be processed',
});

export const dianErrorsCounter = posMeter.createCounter('pos.dian.errors', {
  description: 'Errors during DIAN communication',
});

export const tenantConsumptionCounter = posMeter.createCounter('pos.tenant.consumption', {
  description: 'Usage count per tenant',
});

const sdk = new NodeSDK({
  resource,
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy instrumentations if needed
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-express': { enabled: false },
      '@opentelemetry/instrumentation-fastify': { enabled: true },
      '@opentelemetry/instrumentation-ioredis': { enabled: true },
      '@opentelemetry/instrumentation-pg': { enabled: true }
    }),
  ],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.log('Error terminating tracing', error))
    .finally(() => process.exit(0));
});
