import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createProductBodySchema } from '../src/modules/products/schemas.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const fiscalMigrationPath = resolve(
  currentDir,
  '../src/infra/db/migrations/003_colombia_fiscal_profile.ts'
);

describe('fiscal defaults', () => {
  it('defines IVA/IVA_19 defaults when creating tenant/product', async () => {
    const parsedProductPayload = createProductBodySchema.parse({
      name: 'Cafe Americano',
      category: 'Bebidas',
      price_cents: 7500
    });

    expect(parsedProductPayload.taxCategory).toBe('IVA_19');

    const migrationSource = await readFile(fiscalMigrationPath, 'utf8');

    expect(migrationSource).toContain("ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'IVA'");
    expect(migrationSource).toContain("ADD COLUMN tax_category TEXT NOT NULL DEFAULT 'IVA_19'");
  });
});
