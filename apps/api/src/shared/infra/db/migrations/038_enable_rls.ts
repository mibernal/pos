import { sql, Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Activar Row Level Security explícitamente en la tabla sales
  await sql`ALTER TABLE sales ENABLE ROW LEVEL SECURITY;`.execute(db);

  // Crear política de aislamiento.
  // Permite todas las operaciones (ALL) si el tenant_id de la fila coincide con el tenant_id actual de la sesión.
  // current_setting('app.current_tenant', true) retorna NULL si no está seteado, y null nunca igualará al tenant_id,
  // bloqueando el acceso por defecto.
  await sql`
    CREATE POLICY tenant_isolation_policy ON sales
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant', true));
  `.execute(db);

  // Asegurar que incluso los dueños de tabla sean afectados por RLS
  // NOTA: 'postgres' o superusers igual hacen bypass de RLS a menos que se revoque. 
  await sql`ALTER TABLE sales FORCE ROW LEVEL SECURITY;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP POLICY IF EXISTS tenant_isolation_policy ON sales;`.execute(db);
  await sql`ALTER TABLE sales DISABLE ROW LEVEL SECURITY;`.execute(db);
  await sql`ALTER TABLE sales NO FORCE ROW LEVEL SECURITY;`.execute(db);
}
