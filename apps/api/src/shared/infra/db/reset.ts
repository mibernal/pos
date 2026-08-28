import { createAdminDb } from './connection.js';
import { sql } from 'kysely';

async function resetDatabase() {
  const db = createAdminDb();
  try {
    console.log('[reset] Dropping public schema...');
    await sql`DROP SCHEMA public CASCADE;`.execute(db);
    
    console.log('[reset] Recreating public schema...');
    await sql`CREATE SCHEMA public;`.execute(db);
    
    console.log('[reset] ✅ Database schema has been completely reset.');
  } catch (error) {
    console.error('[reset] ❌ Failed to reset database:', error);
  } finally {
    await db.destroy();
    process.exit(0);
  }
}

resetDatabase();
