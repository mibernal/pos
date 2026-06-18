import { Kysely } from 'kysely';

export async function up(_db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // This is a stub migration. 
  // It replaces the original 042_inventory_valuation_branch.ts which was renamed to 055_inventory_valuation_branch.ts
  // This prevents the "corrupted migrations: previously executed migration is missing" error on existing environments.
}

export async function down(_db: Kysely<any>): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  // Stub
}
