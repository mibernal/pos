import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createMigrator, printMigrationResults } from './migrator.js';
import type { Database } from './schema.js';

/**
 * Migrador. Se ejecuta como paso de despliegue, antes de arrancar la API:
 *
 *   pnpm --filter @pos-dian/api db:migrate:prod      # con el bundle ya compilado
 *   node dist/shared/infra/db/migrate.js             # dentro del contenedor
 *
 * Deliberadamente NO importa `app/env.ts`. Ese esquema valida toda la configuración de la
 * API —claves de Resend, proveedor DIAN, orígenes de CORS— y en producción hace fallar el
 * arranque si falta cualquiera de ellas. Migrar no necesita nada de eso, y exigirlo obliga
 * a repartir secretos no relacionados a un contenedor efímero que solo toca el esquema.
 * Aquí basta la conexión del dueño.
 */
function readAdminConnectionString(): string {
  const connectionString = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      '[migrate] Falta ADMIN_DATABASE_URL (o DATABASE_URL). Las migraciones necesitan el rol\n' +
      '          dueño del esquema: el rol de la API no tiene permisos de DDL.'
    );
    process.exit(1);
  }

  return connectionString;
}

async function runMigrations(): Promise<void> {
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: readAdminConnectionString(), max: 2 }) })
  });

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
