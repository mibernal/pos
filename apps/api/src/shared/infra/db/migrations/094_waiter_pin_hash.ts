import { sql, Kysely } from 'kysely';

/**
 * Migración 094 — El PIN del mesero deja de guardarse en claro.
 *
 * `waiters.pin` era un `varchar(20)` que se insertaba tal cual, el repositorio hacía
 * `selectAll()` y el esquema de respuesta de `GET /branches/:branchId/waiters` incluía el
 * campo. Esa ruta está abierta a propósito a cualquiera con el módulo activo —la usa el
 * selector de mesero, que maneja un cajero—, así que **cualquier empleado podía leer el PIN
 * de todos sus compañeros** desde la pestaña de red del navegador. La pantalla pintaba
 * `****`; la respuesta traía el número.
 *
 * Se adopta el mismo mecanismo que ya usa `users.pin_hash` desde la migración 056: Argon2
 * a través de `hashPassword`, y verificación por comparación.
 *
 * **Los PIN existentes se pierden y hay que volver a asignarlos.** Un hash no se puede
 * derivar hacia atrás y dejar el texto plano «por compatibilidad» sería no arreglar nada.
 * Un mesero sin PIN sigue pudiendo trabajar: el PIN es una confirmación de identidad, no
 * una credencial de acceso.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('waiters')
    .addColumn('pin_hash', 'varchar(255)')
    .execute();

  await db.schema
    .alterTable('waiters')
    .dropColumn('pin')
    .execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('waiters')
    .addColumn('pin', 'varchar(20)')
    .execute();

  await db.schema
    .alterTable('waiters')
    .dropColumn('pin_hash')
    .execute();

  // No se restauran valores: no existe forma de recuperar el texto plano desde el hash,
  // que es justamente el punto de la migración.
  await sql`SELECT 1`.execute(db);
}
