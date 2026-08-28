import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql, Transaction } from 'kysely';
import { Pool } from 'pg';
import { createDb } from '../connection.js';
import type { Database } from '../schema.js';
import { executeAsTenant } from '../rls.js';
import { randomUUID } from 'node:crypto';

/**
 * Validación de aislamiento por tenant a nivel de motor.
 *
 * Estas pruebas solo significan algo si la conexión de la app NO tiene BYPASSRLS. Con el
 * dueño del esquema todas pasarían por accidente —de hecho tres de ellas estuvieron
 * marcadas `skip` justamente porque el rol de conexión las saltaba—, así que aquí se
 * comprueba primero esa precondición y se falla con un mensaje claro si no se cumple.
 *
 * `appDb` es la conexión restringida (la que usa la API). `adminDb` es la del dueño del
 * esquema y se usa solo para sembrar y limpiar, igual que las migraciones y las semillas
 * en un despliegue real.
 */

const appDb = createDb();

const adminDb = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
      max: 2
    })
  })
});

describe('Aislamiento por tenant en PostgreSQL (RLS)', () => {
  let tenantA: string;
  let tenantB: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    const { rows } = await sql<{ bypassrls: boolean; rolname: string }>`
      SELECT rolname, rolbypassrls AS bypassrls
      FROM pg_roles WHERE rolname = current_user
    `.execute(appDb);

    const role = rows[0];
    if (!role || role.bypassrls) {
      throw new Error(
        `La conexión de la app usa el rol "${role?.rolname ?? 'desconocido'}", que salta RLS. ` +
          'Estas pruebas no verifican nada en ese caso. Apunta DATABASE_URL a un rol sin ' +
          'BYPASSRLS (por ejemplo pos_api) y deja el rol dueño en ADMIN_DATABASE_URL.'
      );
    }

    const tA = await adminDb.insertInto('tenants')
      .values({ id: randomUUID(), address: 'addr', name: 'Tenant A', nit: `NIT-A-${randomUUID().slice(0, 8)}`, business_name: 'B A' })
      .returning('id')
      .executeTakeFirstOrThrow();
    tenantA = tA.id;

    const tB = await adminDb.insertInto('tenants')
      .values({ id: randomUUID(), address: 'addr', name: 'Tenant B', nit: `NIT-B-${randomUUID().slice(0, 8)}`, business_name: 'B B' })
      .returning('id')
      .executeTakeFirstOrThrow();
    tenantB = tB.id;

    const pA = await adminDb.insertInto('products')
      .values({ id: randomUUID(), tenant_id: tenantA, name: 'Product A', price_cents: 100, tax_category: 'EXCLUDED', active: true, category: 'STANDARD', cost_cents: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
    productA = pA.id;

    const pB = await adminDb.insertInto('products')
      .values({ id: randomUUID(), tenant_id: tenantB, name: 'Product B', price_cents: 200, tax_category: 'EXCLUDED', active: true, category: 'STANDARD', cost_cents: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
    productB = pB.id;
  });

  afterAll(async () => {
    await adminDb.deleteFrom('products').where('id', 'in', [productA, productB]).execute();
    await adminDb.deleteFrom('tenants').where('id', 'in', [tenantA, tenantB]).execute();
    await adminDb.destroy();
    await appDb.destroy();
  });

  it('sin contexto de tenant no devuelve ninguna fila', async () => {
    // Es el caso de olvidar `executeAsTenant`. Debe fallar cerrado, no abierto.
    await appDb.transaction().execute(async (trx: Transaction<Database>) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productA)
        .selectAll()
        .execute();

      expect(result).toHaveLength(0);
    });
  });

  it('con su contexto, el tenant lee su propio producto', async () => {
    await executeAsTenant(appDb, tenantA, async (trx) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productA)
        .selectAll()
        .execute();

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(productA);
    });
  });

  it('un tenant no puede leer el producto de otro ni pidiéndolo por id', async () => {
    await executeAsTenant(appDb, tenantA, async (trx) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productB)
        .selectAll()
        .execute();

      expect(result).toHaveLength(0);
    });
  });

  it('un tenant no puede modificar ni borrar filas de otro', async () => {
    await executeAsTenant(appDb, tenantA, async (trx) => {
      const updateResult = await trx.updateTable('products')
        .set({ price_cents: 9999 })
        .where('id', '=', productB)
        .executeTakeFirst();

      // El motor no lanza error: simplemente no hay filas visibles que afectar.
      expect(Number(updateResult.numUpdatedRows)).toBe(0);

      const deleteResult = await trx.deleteFrom('products')
        .where('id', '=', productB)
        .executeTakeFirst();

      expect(Number(deleteResult.numDeletedRows)).toBe(0);
    });

    await executeAsTenant(appDb, tenantB, async (trx) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productB)
        .selectAll()
        .executeTakeFirst();

      expect(result).toBeDefined();
      expect(result?.price_cents).toBe(200);
    });
  });

  it('un tenant no puede insertar filas a nombre de otro', async () => {
    await executeAsTenant(appDb, tenantA, async (trx) => {
      await expect(
        trx.insertInto('products')
          .values({
            id: randomUUID(),
            tenant_id: tenantB,
            name: 'Producto infiltrado',
            price_cents: 1,
            tax_category: 'EXCLUDED',
            active: true,
            category: 'STANDARD',
            cost_cents: 0
          })
          .execute()
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('un COUNT(*) sin WHERE solo cuenta las filas del tenant', async () => {
    const totalA = await executeAsTenant(appDb, tenantA, async (trx) => {
      const row = await trx.selectFrom('products')
        .select((eb) => eb.fn.count('id').as('total'))
        .executeTakeFirst();
      return Number(row?.total ?? 0);
    });

    const totalGlobal = await adminDb
      .selectFrom('products')
      .select((eb) => eb.fn.count('id').as('total'))
      .executeTakeFirst()
      .then((row) => Number(row?.total ?? 0));

    expect(totalA).toBe(1);
    expect(totalGlobal).toBeGreaterThan(totalA);
  });
});
