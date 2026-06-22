import { Kysely, PostgresDialect } from 'kysely';
import { Database } from '../src/shared/infra/db/schema.js';
import pg from 'pg';
import { KdsRepository } from '../src/contexts/tables/infra/kds.repository.js';
import { KitchenTicketWithItemsSchema } from '@pos-dian/shared';

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      // @ts-ignore
      connectionString: process.env.DATABASE_URL
    })
  })
});

const kdsRepo = new KdsRepository(db);

async function main() {
  const tenantId = '11111111-1111-4111-8111-111111111111'; // Dummy, use the first tenant
  const tenant = await db.selectFrom('tenants').select('id').executeTakeFirst();
  if (!tenant) return console.error('No tenant found');
  const branch = await db.selectFrom('branches').where('tenant_id', '=', tenant.id).select('id').executeTakeFirst();
  if (!branch) return console.error('No branch found');

  const tickets = await kdsRepo.getActiveTickets(tenant.id, branch.id);
  console.log('Fetched tickets:', tickets.length);

  if (tickets.length > 0) {
    try {
      KitchenTicketWithItemsSchema.array().parse(tickets);
      console.log('Zod parse SUCCESS!');
    } catch (e) {
      console.error('Zod parse ERROR:', JSON.stringify(e, null, 2));
    }
  }
}

main().catch(console.error).finally(() => db.destroy());
