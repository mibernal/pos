import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
export const idempotencyPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'OPTIONS' || request.method === 'HEAD') {
      return;
    }

    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return;
    }

    const tenantId = (request.user as any)?.tenantId;
    if (!tenantId) {
      return;
    }

    const record = await fastify.db
      .selectFrom('idempotency_records')
      .selectAll()
      .where('key', '=', idempotencyKey)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (record) {
      reply.status(record.status_code).send(record.response_body_json);
      return reply;
    }
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return payload;
    }
    
    if (reply.statusCode >= 500) {
      return payload;
    }

    const tenantId = (request.user as any)?.tenantId;
    const userId = (request.user as any)?.userId || null;
    if (!tenantId) {
      return payload;
    }

    let parsedPayload: any = null;
    try {
      if (typeof payload === 'string') {
        parsedPayload = JSON.parse(payload);
      } else {
        parsedPayload = payload;
      }
    } catch {
      parsedPayload = { data: payload?.toString() };
    }

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    fastify.db.insertInto('idempotency_records')
      .values({
        key: idempotencyKey,
        tenant_id: tenantId,
        user_id: userId,
        path: request.url,
        status_code: reply.statusCode,
        response_body_json: parsedPayload,
        expires_at: expiresAt
      })
      .onConflict((oc: any) => oc.column('key').doNothing())
      .execute()
      .catch((err: any) => {
        request.log.error({ err, idempotencyKey }, 'Failed to save idempotency record');
      });

    return payload;
  });
});
