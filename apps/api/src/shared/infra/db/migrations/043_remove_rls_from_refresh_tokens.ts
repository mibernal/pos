import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Los refresh tokens son buscados por hash criptográfico seguro en endpoints NO autenticados.
  // El RLS rompe esta lógica porque no se conoce el tenant_id previamente.
  // Deshabilitamos RLS para esta tabla. No hay riesgo de fuga cruzada porque el hash es inescrutable.
  await sql`ALTER TABLE refresh_tokens NO FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE refresh_tokens DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON refresh_tokens`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_policy ON refresh_tokens
    FOR ALL USING (tenant_id::text = current_setting('app.current_tenant', true))
  `.execute(db);
}
