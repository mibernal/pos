import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Database } from './src/shared/infra/db/schema.js';
import { KdsRepository } from './src/contexts/tables/infra/kds.repository.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool })
});

async function main() {
  const repo = new KdsRepository(db);
  // Get the first tenant
  const tenant = await db.selectFrom('tenants').selectAll().limit(1).executeTakeFirst();
  const branchId = '22222222-5555-4444-8444-555555555555';
  console.log('Querying for tenant:', tenant?.id, 'branch:', branchId);
  try {
    const tickets = await repo.getActiveTickets(tenant!.id, branchId);
    console.log('Tickets found:', tickets.length);
    console.dir(tickets, { depth: null });
  } catch (err) {
    console.error('Error fetching tickets:', err);
  } finally {
    await db.destroy();
  }
}
main();
