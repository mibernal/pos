import type { FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { env } from '../../../app/env.js';

export class PubSubService {
  private subscriber: Redis | null = null;
  private publisher: Redis | null = null;
  private sseClients = new Map<string, Set<FastifyReply['raw']>>();

  constructor() {
    if (env.NODE_ENV !== 'test') {
      this.subscriber = new Redis(env.REDIS_URL);
      this.publisher = new Redis(env.REDIS_URL);

      this.subscriber.subscribe('kds_events', (err: Error | null | undefined) => {
        if (err) {
          console.error('Error subscribing to kds_events', err);
        }
      });

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === 'kds_events') {
          try {
            const data = JSON.parse(message);
            const key = `${data.tenantId}:${data.branchId}`;
            const clients = this.sseClients.get(key);
            if (clients) {
              for (const client of clients) {
                // Ensure proper SSE format
                client.write(`event: ${data.eventType}\n`);
                client.write(`data: ${message}\n\n`);
              }
            }
          } catch (e) {
            console.error('Error processing kds_event message', e);
          }
        }
      });
    }
  }

  addKdsClient(tenantId: string, branchId: string, replyRaw: FastifyReply['raw']) {
    const key = `${tenantId}:${branchId}`;
    if (!this.sseClients.has(key)) {
      this.sseClients.set(key, new Set());
    }
    this.sseClients.get(key)!.add(replyRaw);

    // Escribir evento inicial de conexión
    replyRaw.write('event: connected\ndata: {"status": "ok"}\n\n');

    replyRaw.on('close', () => {
      this.removeKdsClient(tenantId, branchId, replyRaw);
    });
  }

  removeKdsClient(tenantId: string, branchId: string, replyRaw: FastifyReply['raw']) {
    const key = `${tenantId}:${branchId}`;
    const clients = this.sseClients.get(key);
    if (clients) {
      clients.delete(replyRaw);
      if (clients.size === 0) {
        this.sseClients.delete(key);
      }
    }
  }

  async publishKdsEvent(tenantId: string, branchId: string, eventType: string, payload?: any) {
    if (!this.publisher) return;
    const message = JSON.stringify({ tenantId, branchId, eventType, ...payload });
    await this.publisher.publish('kds_events', message);
  }

  async close() {
    await this.subscriber?.quit();
    await this.publisher?.quit();
  }
}
