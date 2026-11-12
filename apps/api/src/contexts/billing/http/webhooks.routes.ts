import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { processPaymentWebhook, type WebhookOutcome } from '../application/process-payment-webhook.js';

/**
 * Código HTTP por desenlace.
 *
 * Antes las tres rutas respondían 200 a todo —firma inválida incluida— «para evitar
 * reintentos infinitos maliciosos». Eso protege de un atacante y a la vez descarta el
 * reintento legítimo: si la base fallaba mientras se procesaba un pago aprobado, la
 * pasarela lo daba por entregado y el cobro se perdía sin dejar rastro.
 *
 * La distinción correcta no es «reintentar o no», es **de quién fue el fallo**:
 *  - firma inválida → 400. No es un evento de la pasarela; que no reintente.
 *  - no es nuestro, o ya se aplicó → 200. Nada que hacer.
 *  - fallo nuestro → 500. Que reintente, que para eso reintenta.
 */
const STATUS_BY_OUTCOME: Record<WebhookOutcome, number> = {
  rejected: 400,
  ignored: 200,
  duplicate: 200,
  processed: 200,
  failed: 500
};

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Conservar el body crudo para las validaciones criptográficas de webhooks
  typedApp.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as any).rawBody = body; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  function readRawBody(request: FastifyRequest): string {
    return (
      (request.raw as any)?.rawBody || // eslint-disable-line @typescript-eslint/no-explicit-any
      (request as any).rawBody || // eslint-disable-line @typescript-eslint/no-explicit-any
      (typeof request.body === 'string' ? request.body : JSON.stringify(request.body))
    );
  }

  async function handle(
    gateway: 'WOMPI' | 'MERCADOPAGO' | 'STRIPE',
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    let result;

    try {
      result = await processPaymentWebhook(app.db, {
        gateway,
        headers: request.headers as Record<string, string>,
        rawBody: readRawBody(request)
      });
    } catch (err) {
      // Un fallo no previsto es nuestro: 500 para que la pasarela vuelva a intentarlo.
      app.log.error({ err, gateway }, 'Fallo no controlado procesando un webhook de pago');
      return reply.code(500).send({ outcome: 'failed' });
    }

    if (result.outcome === 'rejected' || result.outcome === 'failed') {
      app.log.warn(
        { gateway, outcome: result.outcome, detail: result.detail, eventLogId: result.eventLogId },
        'Webhook de pago no aplicado'
      );
    }

    return reply.code(STATUS_BY_OUTCOME[result.outcome]).send({ outcome: result.outcome });
  }

  typedApp.post('/webhooks/payments/wompi', { schema: { tags: ['webhooks'] } }, (request, reply) =>
    handle('WOMPI', request, reply)
  );

  typedApp.post('/webhooks/payments/mercadopago', { schema: { tags: ['webhooks'] } }, (request, reply) =>
    handle('MERCADOPAGO', request, reply)
  );

  typedApp.post('/webhooks/payments/stripe', { schema: { tags: ['webhooks'] } }, (request, reply) =>
    handle('STRIPE', request, reply)
  );
};
