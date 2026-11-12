import type { FastifyReply, FastifyRequest } from 'fastify';

// Simula un registro global de conexiones SSE por usuario
// En un sistema distribuido real, usarías Redis (ej. SETNX y EXPIRE o un sorted set con latidos)
const activeSseConnections = new Map<string, number>();
const MAX_CONNECTIONS_PER_USER = 5;

export function registerSseConnection(userId: string): void {
  const current = activeSseConnections.get(userId) || 0;
  if (current >= MAX_CONNECTIONS_PER_USER) {
    throw new Error('TOO_MANY_SSE_CONNECTIONS');
  }
  activeSseConnections.set(userId, current + 1);
}

export function unregisterSseConnection(userId: string): void {
  const current = activeSseConnections.get(userId) || 0;
  if (current > 1) {
    activeSseConnections.set(userId, current - 1);
  } else {
    activeSseConnections.delete(userId);
  }
}

/**
 * Inicia el stream SSE estableciendo los headers correspondientes.
 * Mantiene la conexión viva y lanza un heartbeat periodico.
 */
export function setupSseStream(request: FastifyRequest, reply: FastifyReply, pingIntervalMs = 30000) {
  if (!request.auth) throw new Error('No autorizado');
  const userId = request.auth.userId;

  try {
    registerSseConnection(userId);
  } catch (err) { // eslint-disable-line @typescript-eslint/no-unused-vars
    reply.status(429).send({ message: 'Demasiadas conexiones activas.' });
    return null;
  }

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  let active = true;

  // Heartbeat / Keep-alive
  const pingInterval = setInterval(() => {
    if (!active) return;
    reply.raw.write(':ping\n\n');
  }, pingIntervalMs);

  const cleanup = () => {
    if (!active) return;
    active = false;
    clearInterval(pingInterval);
    unregisterSseConnection(userId);
    reply.raw.end();
  };

  request.raw.on('close', cleanup);

  return {
    isActive: () => active,
    /**
     * Recibe el objeto, no su serialización.
     *
     * El tipo era `any` y un llamador le pasó una cadena ya serializada. Como aquí se
     * serializa otra vez, por el cable viajaba un JSON dentro de un JSON; el navegador
     * desenvuelve una capa y se queda con un `string` donde esperaba el objeto, así que
     * todos sus campos son `undefined`. El panel en vivo enseñaba «$ NaN» en la caja del
     * día, y nada falló por el camino: ni la ruta, ni el tipado, ni una prueba.
     *
     * `object` en vez de `any` deja que el compilador rechace exactamente ese error.
     */
    writeEvent: (data: object) => {
      if (!active) return;
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    cleanup
  };
}
