import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/**
 * Crea el rol de conexión de la API: un usuario SIN `BYPASSRLS`, para que el aislamiento
 * entre comercios lo imponga PostgreSQL y no la disciplina de quien escribe cada consulta.
 *
 *   pnpm --filter @pos-dian/api db:ensure-api-role
 *   pnpm --filter @pos-dian/api db:ensure-api-role -- "mi-contraseña"
 *
 * Crear roles es una operación del clúster, no de la base: hace falta un rol con
 * `CREATEROLE` (o superusuario). El dueño del esquema no siempre lo tiene — en una base
 * gestionada o creada a mano casi nunca. Cuando no lo tiene, se puede pasar otra conexión:
 *
 *   SUPERUSER_DATABASE_URL=postgres://postgres@localhost:5432/pos_dian \
 *     pnpm --filter @pos-dian/api db:ensure-api-role
 *
 * y si tampoco hay forma, el comando imprime el SQL exacto para que lo ejecute quien pueda.
 *
 * Es el equivalente en Node de `infra/scripts/create-api-role.sh`, y existe porque aquel
 * necesita el cliente `psql` instalado — que no está en todas las máquinas, sobre todo
 * cuando Postgres corre en Docker. Este solo necesita el `pg` que el proyecto ya usa.
 *
 * Crea también `api_user` si falta. Es un rol del **clúster**, no de la base: `pg_dump` no
 * lo exporta, así que restaurar un volcado o recrear el contenedor de Postgres deja el
 * esquema intacto y los roles fuera. Las migraciones 057/089/090 intentan crearlo, pero se
 * lo saltan en silencio si el rol que migra no tiene `CREATEROLE` — y entonces la API acaba
 * conectándose con el dueño del esquema, con el RLS otra vez decorativo.
 */

const ROLE = 'pos_api';
const GROUP_ROLE = 'api_user';

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  → ${hint}`);
  console.error('');
  process.exit(1);
}

/**
 * El SQL equivalente, para quien tenga que ejecutarlo a mano. Se imprime cuando el rol
 * disponible no puede crear roles: es más útil que un mensaje diciendo «pídeselo a tu DBA».
 */
function printManualSql(password: string): void {
  console.error('\n  SQL equivalente, para ejecutar con un rol que sí pueda crear roles:\n');
  console.error(`    CREATE ROLE ${GROUP_ROLE} NOLOGIN;`);
  console.error(`    GRANT USAGE ON SCHEMA public TO ${GROUP_ROLE};`);
  console.error(`    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${GROUP_ROLE};`);
  console.error(`    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${GROUP_ROLE};`);
  console.error(`    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${GROUP_ROLE};`);
  console.error(`    ALTER DEFAULT PRIVILEGES IN SCHEMA public`);
  console.error(`      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${GROUP_ROLE};`);
  console.error(`    ALTER DEFAULT PRIVILEGES IN SCHEMA public`);
  console.error(`      GRANT USAGE, SELECT ON SEQUENCES TO ${GROUP_ROLE};`);
  console.error(`    CREATE USER ${ROLE} WITH PASSWORD '${password}' IN ROLE ${GROUP_ROLE};\n`);
  console.error('  Con Docker suele bastar:\n');
  console.error('    docker exec -i <contenedor-postgres> psql -U postgres -d pos_dian <<\'SQL\'');
  console.error('    …pega aquí el bloque de arriba…');
  console.error("    SQL\n");
  console.error(`  Después, en tu .env:  DATABASE_URL=postgres://${ROLE}:${password}@<host>:5432/<base>\n`);
}

async function main(): Promise<void> {
  // Orden de preferencia: una conexión explícita para crear roles, luego el dueño del
  // esquema, luego lo que haya.
  const connectionString =
    process.env.SUPERUSER_DATABASE_URL ?? process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    fail(
      'Falta ADMIN_DATABASE_URL (o DATABASE_URL).',
      'Este comando necesita conectarse con el rol dueño del esquema, no con el de la API.'
    );
  }

  // Contraseña por argumento, o generada. Se imprime al final para poder copiarla al .env.
  const provided = process.argv[2]?.trim();
  const password = provided && provided.length > 0 ? provided : randomBytes(24).toString('base64url');

  const pool = new Pool({ connectionString, max: 1 });

  try {
    const me = await pool.query<{ user: string; can_create: boolean; is_super: boolean }>(
      `SELECT current_user AS user,
              rolcreaterole AS can_create,
              rolsuper AS is_super
       FROM pg_roles WHERE rolname = current_user`
    );

    const actor = me.rows[0];
    if (!actor) fail('No se pudo identificar el rol de conexión.');

    if (!actor.can_create && !actor.is_super) {
      console.error(`\n✗ El rol "${actor.user}" no puede crear roles (le falta CREATEROLE).\n`);
      console.error('  Crear roles es una operación del clúster. Dos salidas:\n');
      console.error('  1) Repetir el comando con una conexión que sí pueda:\n');
      console.error(
        '     SUPERUSER_DATABASE_URL=postgres://postgres@localhost:5432/<base> \\\n' +
          '       pnpm --filter @pos-dian/api db:ensure-api-role\n'
      );
      console.error(`  2) O dar CREATEROLE al rol actual, una sola vez:\n`);
      console.error(`     ALTER ROLE ${actor.user} CREATEROLE;\n`);
      printManualSql(password);
      await pool.end();
      process.exit(1);
    }

    // 1. El rol de grupo, que es el que lleva los permisos.
    const groupExisted = await pool
      .query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [GROUP_ROLE])
      .then((r) => r.rowCount! > 0);

    if (!groupExisted) {
      await pool.query(`CREATE ROLE ${GROUP_ROLE} NOLOGIN`);
      console.log(`  Rol de grupo ${GROUP_ROLE} creado.`);
    }

    // 2. Los permisos sobre lo que ya existe en el esquema. Es idempotente y barato, y
    //    cubre el caso de un rol recién creado sobre una base ya migrada — que es
    //    justamente lo que pasa al restaurar un volcado.
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${GROUP_ROLE}`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${GROUP_ROLE}`);
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${GROUP_ROLE}`);
    await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${GROUP_ROLE}`);
    await pool.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${GROUP_ROLE}`
    );
    await pool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${GROUP_ROLE}`);

    // 3. El usuario con el que la API se conecta de verdad.
    const userExisted = await pool
      .query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROLE])
      .then((r) => r.rowCount! > 0);

    // La contraseña no puede ir como parámetro: CREATE USER no admite bind. Se escapa
    // duplicando las comillas simples, que es lo único que puede romper el literal.
    const escaped = password.replaceAll("'", "''");

    if (userExisted) {
      await pool.query(`ALTER USER ${ROLE} WITH PASSWORD '${escaped}'`);
      await pool.query(`GRANT ${GROUP_ROLE} TO ${ROLE}`);
    } else {
      await pool.query(`CREATE USER ${ROLE} WITH PASSWORD '${escaped}' IN ROLE ${GROUP_ROLE}`);
    }

    // 4. Comprobar que el rol es realmente inofensivo. Si saltara RLS, todo lo anterior
    //    sería teatro: las políticas existirían y el motor las ignoraría.
    const check = await pool.query<{ bypass: boolean; is_super: boolean }>(
      `SELECT rolbypassrls AS bypass, rolsuper AS is_super FROM pg_roles WHERE rolname = $1`,
      [ROLE]
    );

    const created = check.rows[0]!;
    if (created.bypass || created.is_super) {
      fail(
        `El rol ${ROLE} ${created.is_super ? 'es superusuario' : 'salta RLS'}. El aislamiento entre comercios sería ficticio.`,
        `ALTER ROLE ${ROLE} NOBYPASSRLS NOSUPERUSER;`
      );
    }

    const url = new URL(connectionString);
    const host = url.hostname;
    const port = url.port || '5432';
    const database = url.pathname.replace(/^\//, '') || 'pos_dian';

    console.log(`\n✓ Rol ${ROLE} listo (${userExisted ? 'contraseña actualizada' : 'creado'}), sin BYPASSRLS.\n`);
    console.log('Copia esta línea a tu .env:\n');
    console.log(`  DATABASE_URL=postgres://${ROLE}:${password}@${host}:${port}/${database}\n`);
    console.log('Deja el rol dueño solo en ADMIN_DATABASE_URL: migraciones y semillas lo necesitan.');
    console.log('El worker también usa el rol dueño: sus tareas programadas recorren todos los comercios.\n');
    console.log('Comprueba el resultado con:  pnpm --filter @pos-dian/api db:doctor\n');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\n✗ No se pudo preparar el rol:', error instanceof Error ? error.message : error);
  process.exit(1);
});
