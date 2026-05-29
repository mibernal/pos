import { FileMigrationProvider, Migrator, type MigrationResult, type Kysely } from 'kysely';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Database } from './schema.js';

export function createMigrator(db: Kysely<Database>): Migrator {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFilePath);

  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: join(currentDir, 'migrations')
    })
  });
}

export function printMigrationResults(results: ReadonlyArray<MigrationResult> | undefined): void {
  if (!results) {
    return;
  }

  for (const result of results) {
    if (result.status === 'Success') {
      console.info(`[migrate] ${result.migrationName} -> OK`);
    } else {
      console.error(`[migrate] ${result.migrationName} -> ${result.status}`);
    }
  }
}
