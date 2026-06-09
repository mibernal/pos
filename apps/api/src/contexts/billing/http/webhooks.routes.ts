import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { processPaymentWebhook } from '../application/process-payment-webhook.js';

export const webhooksRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // WOMPI WEBHOOK
  typedApp.post(
    '/webhooks/payments/wompi',
    {
      schema: {
        tags: ['webhooks']
      }
    },
    async (request, reply) => {
      // Wompi sends application/json
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

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
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

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
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

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
