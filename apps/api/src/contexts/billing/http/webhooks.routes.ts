import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { processPaymentWebhook } from '../application/process-payment-webhook.js';

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

  // WOMPI WEBHOOK
  typedApp.post(
    '/webhooks/payments/wompi',
    {
      schema: {
        tags: ['webhooks']
      }
    },
    async (request, reply) => {
      // Obtener el body original antes de ser parseado
      const rawBody = (request.raw as any)?.rawBody || (request as any).rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)); // eslint-disable-line @typescript-eslint/no-explicit-any

      try {
        await processPaymentWebhook(app.db, {
          gateway: 'WOMPI',
          headers: request.headers as Record<string, string>,
          rawBody
        });
      } catch (err) {
        app.log.error(err);
        // Retornamos 200 aunque falle la firma en webhooks para evitar reintentos infinitos maliciosos
        // Pero idealmente si es error de validación retornamos 400
      }

      return reply.code(200).send();
    }
  );

  // MERCADOPAGO WEBHOOK
  typedApp.post(
    '/webhooks/payments/mercadopago',
    {
      schema: {
        tags: ['webhooks']
      }
    },
    async (request, reply) => {
      const rawBody = (request.raw as any)?.rawBody || (request as any).rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)); // eslint-disable-line @typescript-eslint/no-explicit-any

      try {
        await processPaymentWebhook(app.db, {
          gateway: 'MERCADOPAGO',
          headers: request.headers as Record<string, string>,
          rawBody
        });
      } catch (err) {
        app.log.error(err);
      }

      return reply.code(200).send();
    }
  );

  // STRIPE WEBHOOK
  typedApp.post(
    '/webhooks/payments/stripe',
    {
      schema: {
        tags: ['webhooks']
      }
    },
    async (request, reply) => {
      const rawBody = (request.raw as any)?.rawBody || (request as any).rawBody || (typeof request.body === 'string' ? request.body : JSON.stringify(request.body)); // eslint-disable-line @typescript-eslint/no-explicit-any

      try {
        await processPaymentWebhook(app.db, {
          gateway: 'STRIPE',
          headers: request.headers as Record<string, string>,
          rawBody
        });
      } catch (err) {
        app.log.error(err);
      }

      return reply.code(200).send();
    }
  );
};
