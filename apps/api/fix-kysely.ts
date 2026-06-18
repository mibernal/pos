import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query("UPDATE kysely_migration SET name = '055_inventory_valuation_branch' WHERE name = '042_inventory_valuation_branch'");
    console.log(`Updated ${res.rowCount} rows in kysely_migration.`);
  } catch (e) {
    console.error("Error updating kysely_migration:", e);
  } finally {
    await pool.end();
  }
}
main();
