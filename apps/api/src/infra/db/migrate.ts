import { createDb } from './connection.js';
import { createMigrator, printMigrationResults } from './migrator.js';

async function runMigrations(): Promise<void> {
  const db = createDb();

  try {
    const migrator = createMigrator(db);
    const result = await migrator.migrateToLatest();

    printMigrationResults(result.results);

    if (result.error) {
      throw result.error;
    }

    console.info('[migrate] Database schema is up to date');
  } finally {
    await db.destroy();
  }
}

runMigrations().catch((error) => {
  console.error('[migrate] Failed to migrate', error);
  process.exit(1);
});
