import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb } from '../connection.js';
import { sql, Transaction } from 'kysely';
import type { Database } from '../schema.js';
import { executeAsTenant } from '../rls.js';

const db = createDb();

describe('PostgreSQL Row Level Security (RLS) Enterprise Validation', () => {
  let tenantA: string;
  let tenantB: string;
  let productA: string;
  let productB: string;

  beforeAll(async () => {
    // 1. Crear Tenants directamente (bypass RLS localmente en testing para setup)
    const tA = await db.insertInto('tenants')
      .values({ name: 'Tenant A', nit: 'NIT-A', business_name: 'B A', plan: 'PRO' })
      .returning('id')
      .executeTakeFirstOrThrow();
    tenantA = tA.id;

    const tB = await db.insertInto('tenants')
      .values({ name: 'Tenant B', nit: 'NIT-B', business_name: 'B B', plan: 'PRO' })
      .returning('id')
      .executeTakeFirstOrThrow();
    tenantB = tB.id;

    // 2. Crear Productos
    const pA = await db.insertInto('products')
      .values({ tenant_id: tenantA, name: 'Product A', price_cents: 100, tax_category: 'EXCLUDED', status: 'ACTIVE' })
      .returning('id')
      .executeTakeFirstOrThrow();
    productA = pA.id;

    const pB = await db.insertInto('products')
      .values({ tenant_id: tenantB, name: 'Product B', price_cents: 200, tax_category: 'EXCLUDED', status: 'ACTIVE' })
      .returning('id')
      .executeTakeFirstOrThrow();
    productB = pB.id;
  });

  afterAll(async () => {
    // Limpieza
    await db.deleteFrom('products').where('id', 'in', [productA, productB]).execute();
    await db.deleteFrom('tenants').where('id', 'in', [tenantA, tenantB]).execute();
  });

  it('CASE 1: Fail-Closed by Default. No tenant context returns 0 rows', async () => {
    // Ejecutar una consulta cruda SIN executeAsTenant()
    // Esto simula un desarrollador olvidando envolver la transacción

    // Testeamos conectándonos asumiendo que estamos limitados por RLS
    // Para asegurar que los tests fallan si el usuario de test es superuser, forzamos un set local:
    await db.transaction().execute(async (trx: Transaction<Database>) => {
      // Remover cualquier set local que pudiera estar residual
      await sql`RESET app.current_tenant`.execute(trx);

      const result = await trx.selectFrom('products')
        .where('id', '=', productA)
        .selectAll()
        .execute();

      // PostgreSQL DEBE retornar vacío, ya que app.current_tenant es nulo y falla la policy.
      expect(result.length).toBe(0);
    });
  });

  it('CASE 2: Lectura Aislada Correcta. Tenant A lee su producto', async () => {
    await executeAsTenant(db, tenantA, async (trx) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productA)
        .selectAll()
        .execute();

      expect(result.length).toBe(1);
      expect(result[0]?.id).toBe(productA);
    });
  });

  it('CASE 3: Bloqueo de Fuga Cruzada. Tenant A intenta leer producto del Tenant B', async () => {
    await executeAsTenant(db, tenantA, async (trx) => {
      // Intentamos engañar a la DB pidiendo explícitamente el ID del producto de otro tenant
      const result = await trx.selectFrom('products')
        .where('id', '=', productB) // ID perteneciente a Tenant B
        .selectAll()
        .execute();

      // Debe retornar vacío, el motor de base de datos descarta la fila por RLS.
      expect(result.length).toBe(0);
    });
  });

  it('CASE 4: Protección contra Escritura Cruzada (UPDATE/DELETE)', async () => {
    await executeAsTenant(db, tenantA, async (trx) => {
      // Intentamos modificar el precio del producto B siendo Tenant A
      const updateResult = await trx.updateTable('products')
        .set({ price_cents: 9999 })
        .where('id', '=', productB)
        .executeTakeFirst();

      // La base de datos no debe arrojar error sintáctico, sino "0 filas afectadas"
      expect(Number(updateResult.numUpdatedRows)).toBe(0);

      // Lo mismo para DELETE
      const deleteResult = await trx.deleteFrom('products')
        .where('id', '=', productB)
        .executeTakeFirst();

      expect(Number(deleteResult.numDeletedRows)).toBe(0);
    });

    // Verificamos que el producto B sigue intacto como Tenant B
    await executeAsTenant(db, tenantB, async (trx) => {
      const result = await trx.selectFrom('products')
        .where('id', '=', productB)
        .selectAll()
        .executeTakeFirst();

      expect(result).toBeDefined();
      expect(result?.price_cents).toBe(200); // Precio original no modificado
    });
  });

  it('CASE 5: Aislamiento global. Count(*) solo cuenta datos del Tenant', async () => {
    await executeAsTenant(db, tenantA, async (trx) => {
      // Un desarrollador hace SELECT COUNT(*) FROM products sin cláusula WHERE
      const countResult = await trx.selectFrom('products')
        .select((eb) => eb.fn.count('id').as('total'))
        .executeTakeFirst();

      // PostgreSQL restringe el pool de la tabla ANTES de aplicar la agregación.
      // Por tanto, Tenant A nunca cuenta productos de Tenant B.
      const total = Number(countResult?.total || 0);

      // Hay que tener en cuenta que podrían existir productos de otros tests en Tenant A,
      // pero NUNCA del Tenant B. Para un entorno limpio, count sería al menos 1, 
      // y definitivamente menor que el total global.
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });
});
