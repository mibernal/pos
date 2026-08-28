import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sql } from 'kysely';
import type { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { executeAsTenant } from '../../../shared/infra/db/rls.js';

/**
 * Webhook del PAC: la otra mitad del cierre del ciclo fiscal.
 *
 * La emisión es asíncrona. El PAC acusa recibo (`SENT`) y resuelve después. Hay dos formas
 * de enterarse del desenlace y conviene tener las dos:
 *
 *  - **Preguntar** (`dian-sent-recheck.scheduler.ts`): funciona siempre, pero con latencia
 *    y consumiendo llamadas al proveedor.
 *  - **Que nos avisen** (este endpoint): inmediato, pero depende de que el PAC lo llame y
 *    de que la red lo permita. Un webhook perdido no deja el documento colgado porque el
 *    scheduler lo acaba resolviendo.
 *
 * Tres decisiones de seguridad, porque este endpoint es público por necesidad:
 *
 * 1. **Firma HMAC obligatoria.** Sin ella, cualquiera podría marcar como aceptada una
 *    factura que la DIAN rechazó. Se compara en tiempo constante.
 * 2. **No se confía en el `tenant_id` del cuerpo.** El comercio se deduce del documento que
 *    se está resolviendo; si viniera del cuerpo, un webhook firmado con la clave de un
 *    comercio podría tocar documentos de otro.
 * 3. **Responde 200 salvo firma inválida.** Un 500 hace que el PAC reintente en bucle; los
 *    problemas de datos se registran y se aceptan, para no montar una tormenta de
 *    reintentos por un documento que ya no existe.
 *
 * **Por qué la URL lleva el comercio.** Una petición del PAC no trae sesión, y la API se
 * conecta con un rol sin `BYPASSRLS`: sin contexto de comercio, la consulta a
 * `dian_documents` devolvería cero filas y el webhook nunca encontraría nada. El comercio
 * viene en la ruta, se fija como contexto y el RLS hace el resto — de modo que una
 * notificación dirigida a un comercio no puede tocar los documentos de otro ni por error.
 * La firma sigue siendo lo que autentica; la ruta solo delimita el alcance.
 */

const webhookBodySchema = z.object({
  /** CUDE/CUFE, o prefijo + número: al menos una forma de identificar el documento. */
  cude: z.string().min(1).optional(),
  prefix: z.string().min(1).optional(),
  document_number: z.coerce.number().int().positive().optional(),
  document_id: z.string().uuid().optional(),
  status: z.enum(['ACCEPTED', 'REJECTED', 'SENT']),
  rejection_reason: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional()
});

function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const dianWebhookRoutes: FastifyPluginAsync = async (app) => {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // El cuerpo crudo se conserva para verificar la firma: `JSON.stringify` del objeto ya
  // parseado no reproduce byte a byte lo que firmó el PAC (orden de claves, espacios), y
  // una firma que a veces coincide es peor que ninguna.
  typedApp.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  typedApp.post(
    '/webhooks/dian/:tenantId/status',
    {
      schema: {
        summary: 'Notificación del PAC sobre el desenlace de un documento',
        tags: ['webhooks', 'fiscal'],
        params: z.object({ tenantId: z.string().uuid() }),
        body: webhookBodySchema,
        response: {
          200: z.object({ received: z.boolean(), applied: z.boolean(), reason: z.string().nullable() }),
          401: z.object({ error: z.object({ code: z.string(), message: z.string() }) })
        }
      }
    },
    async (request, reply) => {
      const secret = process.env.DIAN_WEBHOOK_SECRET;

      if (!secret) {
        // Sin secreto configurado el endpoint no existe: aceptar notificaciones sin firmar
        // sería peor que no tener webhook.
        request.log.warn('Webhook DIAN recibido pero DIAN_WEBHOOK_SECRET no está configurado');
        return reply.status(401).send({
          error: { code: 'AUTH_UNAUTHORIZED', message: 'Webhook no habilitado' }
        });
      }

      const provided = request.headers['x-dian-signature'];
      const rawBody = (request as { rawBody?: string | Buffer }).rawBody;
      const payloadForSignature =
        typeof rawBody === 'string' ? rawBody : rawBody ? rawBody.toString('utf8') : JSON.stringify(request.body);

      const expected = createHmac('sha256', secret).update(payloadForSignature).digest('hex');

      if (typeof provided !== 'string' || !signaturesMatch(expected, provided)) {
        request.log.warn({ error_code: 'DIAN_WEBHOOK_BAD_SIGNATURE' }, 'Firma del webhook DIAN inválida');
        return reply.status(401).send({
          error: { code: 'AUTH_UNAUTHORIZED', message: 'Firma inválida' }
        });
      }

      const body = request.body;
      const { tenantId } = request.params;

      // El comercio sale de la ruta, no del cuerpo: el cuerpo lo escribe quien llama.
      const document = await executeAsTenant(app.db, tenantId, async (trx) => {
        const found = await sql<{ id: string; tenant_id: string; status: string }>`
          SELECT id, tenant_id, status FROM dian_documents
          WHERE ${
            body.document_id
              ? sql`id = ${body.document_id}`
              : body.cude
                ? sql`cude = ${body.cude}`
                : sql`prefix = ${body.prefix ?? null} AND document_number = ${body.document_number ?? null}`
          }
          LIMIT 1
        `.execute(trx);
        return found.rows[0];
      });

      if (!document) {
        // 200 a propósito: reintentar no va a hacer que aparezca, y un 404 provocaría una
        // tormenta de reintentos del PAC.
        request.log.warn({ body }, 'Webhook DIAN: documento no encontrado');
        return reply.send({ received: true, applied: false, reason: 'DOCUMENT_NOT_FOUND' });
      }

      if (document.status === 'ACCEPTED' || document.status === 'REJECTED') {
        // Ya resuelto: un webhook repetido no debe reabrir un documento cerrado.
        return reply.send({ received: true, applied: false, reason: 'ALREADY_RESOLVED' });
      }

      if (body.status === 'SENT') {
        return reply.send({ received: true, applied: false, reason: 'NO_CHANGE' });
      }

      await executeAsTenant(app.db, tenantId, async (trx) => {
        await sql`
          UPDATE dian_documents
          SET status = ${body.status},
              cude = COALESCE(${body.cude ?? null}, cude),
              provider_response_json = ${JSON.stringify({
                source: 'webhook',
                status: body.status,
                rejection_reason: body.rejection_reason ?? null,
                raw: body.raw ?? null
              })}::jsonb,
              updated_at = NOW()
          WHERE id = ${document.id}
        `.execute(trx);
      });

      request.log.info(
        {
          dian_document_id: document.id,
          tenant_id: document.tenant_id,
          previous_status: document.status,
          new_status: body.status
        },
        'Documento DIAN resuelto por webhook del PAC'
      );

      return reply.send({ received: true, applied: true, reason: null });
    }
  );
};
