import type { DomainEvent } from '../../domain/events/DomainEvent.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

export class OutboxPublisher {
  constructor(private readonly db: Kysely<Database>) {}

  async publish(event: DomainEvent, tenantId: string, userId: string): Promise<void> {
    await this.db
      .insertInto('outbox_events')
      .values({
        id: event.id,
        tenant_id: tenantId,
        type: event.type,
        event_version: event.version,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        branch_id: event.branchId || null,
        payload_json: event.payload,
        metadata_json: {
          user_id: userId
        },
        status: 'PENDING',
        attempts: 0,
        next_retry_at: null
      })
      .execute();
  }
}
