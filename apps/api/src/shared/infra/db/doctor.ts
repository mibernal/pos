import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

/**
 * Revisión del despliegue: responde «¿está bien instalado esto?» sin tener que ir mirando
 * tablas a mano.
 *
 *   pnpm --filter @pos-dian/api db:doctor
 *
 * Existe porque los problemas que más tiempo cuestan en este proyecto no dan error al
 * ocurrir: el rol `api_user` que no se creó y dejó la API conectándose con el dueño del
 * esquema (RLS decorativo), o el comercio sin resolución de facturación que no falla hasta
 * la primera venta del día. Todo lo que comprueba aquí ya se pagó una vez.
 *
 * No modifica nada. Solo lee y dice qué hacer.
 */

type Level = 'ok' | 'warn' | 'error';

interface Check {
  level: Level;
  title: string;
  detail: string;
  fix?: string;
}

const results: Check[] = [];

function add(level: Level, title: string, detail: string, fix?: string): void {
  results.push({ level, title, detail, fix });
}

function makeDb(connectionString: string): Kysely<Record<string, never>> {
  return new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ connectionString, max: 1 }) }) });
}

async function main(): Promise<void> {
  const adminUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  const appUrl = process.env.DATABASE_URL;

  if (!adminUrl) {
    console.error('Falta ADMIN_DATABASE_URL (o DATABASE_URL). No hay nada que revisar.');
    process.exit(1);
  }

  const admin = makeDb(adminUrl);

  // ── Esquema ────────────────────────────────────────────────────────────────────────
  const migrations = await sql<{ count: string; last: string }>`
    SELECT count(*)::text AS count, coalesce(max(name), '—') AS last FROM kysely_migration
  `
    .execute(admin)
    .then((r) => r.rows[0])
    .catch(() => null);

  if (!migrations || Number(migrations.count) === 0) {
    add('error', 'Esquema', 'La base no tiene migraciones aplicadas.', 'pnpm --filter @pos-dian/api db:migrate');
  } else {
    add('ok', 'Esquema', `${migrations.count} migraciones aplicadas (última: ${migrations.last}).`);
  }

  // ── Rol de conexión de la API ──────────────────────────────────────────────────────
  //
  // Es la comprobación más importante del archivo. Si la API se conecta con el dueño del
  // esquema, las políticas RLS existen pero no se aplican: el aislamiento entre comercios
  // pasa a depender de que ninguna consulta olvide su `WHERE tenant_id`.
  const apiUserExists = await sql<{ exists: boolean }>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') AS exists
  `
    .execute(admin)
    .then((r) => r.rows[0]?.exists ?? false);

  if (!apiUserExists) {
    add(
      'error',
      'Rol api_user',
      'No existe. Es un rol del clúster, no de la base: restaurar un volcado o recrear el contenedor de Postgres lo deja fuera, porque pg_dump no exporta roles.',
      './infra/scripts/create-api-role.sh "$(openssl rand -base64 32)"'
    );
  } else {
    add('ok', 'Rol api_user', 'Existe.');
  }

  if (appUrl && appUrl !== adminUrl) {
    const app = makeDb(appUrl);
    try {
      const role = await sql<{ rolname: string; bypass: boolean; issuper: boolean }>`
        SELECT rolname, rolbypassrls AS bypass, rolsuper AS issuper
        FROM pg_roles WHERE rolname = current_user
      `
        .execute(app)
        .then((r) => r.rows[0]);

      if (!role) {
        add('warn', 'Conexión de la API', 'No se pudo identificar el rol de conexión.');
      } else if (role.bypass || role.issuper) {
        add(
          'error',
          'Conexión de la API',
          `Se conecta como "${role.rolname}", que ${role.issuper ? 'es superusuario' : 'salta RLS'}. ` +
            'El aislamiento entre comercios NO se está aplicando: las políticas existen pero el motor las ignora.',
          'Apunta DATABASE_URL a pos_api y deja el rol dueño solo en ADMIN_DATABASE_URL.'
        );
      } else {
        // Prueba real: sin contexto de comercio no debe verse ninguna fila.
        const leak = await sql<{ n: string }>`SELECT count(*)::text AS n FROM products`
          .execute(app)
          .then((r) => Number(r.rows[0]?.n ?? 0))
          .catch(() => -1);

        if (leak > 0) {
          add(
            'error',
            'Aislamiento por tenant',
            `Sin fijar el comercio se ven ${leak} productos. El RLS no está filtrando.`,
            'Revisa que las tablas tengan política y FORCE ROW LEVEL SECURITY (migración 088).'
          );
        } else {
          add('ok', 'Conexión de la API', `Rol "${role.rolname}", sin BYPASSRLS, y sin contexto no ve ninguna fila.`);
        }
      }
      await app.destroy();
    } catch (error) {
      add(
        'error',
        'Conexión de la API',
        `No se pudo conectar con DATABASE_URL: ${error instanceof Error ? error.message : String(error)}`,
        'Si el rol no existe: ./infra/scripts/create-api-role.sh "$(openssl rand -base64 32)"'
      );
    }
  } else {
    add(
      'warn',
      'Conexión de la API',
      'DATABASE_URL y ADMIN_DATABASE_URL apuntan al mismo rol. En desarrollo es cómodo; en producción significa que el RLS no se aplica.',
      'Define DATABASE_URL con pos_api y ADMIN_DATABASE_URL con el rol dueño.'
    );
  }

  // ── Configuración fiscal por comercio ──────────────────────────────────────────────
  const tenants = await sql<{
    id: string;
    name: string;
    has_settings: boolean;
    has_resolution: boolean;
    remaining: string | null;
    valid_until: string | null;
    enable_waiters: boolean;
    enable_tables: boolean;
    waiters: string;
  }>`
    SELECT t.id, t.name,
           (s.tenant_id IS NOT NULL) AS has_settings,
           (r.id IS NOT NULL) AS has_resolution,
           (r.range_to - r.current_number)::text AS remaining,
           r.valid_until::text AS valid_until,
           t.enable_waiters, t.enable_tables,
           (SELECT count(*)::text FROM waiters w WHERE w.tenant_id = t.id AND w.is_active) AS waiters
    FROM tenants t
    LEFT JOIN tenant_dian_settings s ON s.tenant_id = t.id
    LEFT JOIN dian_resolutions r ON r.tenant_id = t.id AND r.is_active AND r.document_type = 'INVOICE'
    WHERE t.status <> 'SUSPENDED'
    ORDER BY t.name
  `
    .execute(admin)
    .then((r) => r.rows)
    .catch(() => []);

  for (const tenant of tenants) {
    const label = `${tenant.name}`;

    if (!tenant.has_settings) {
      add('warn', `DIAN · ${label}`, 'Sin proveedor PAC configurado en tenant_dian_settings. No podrá emitir.');
    }

    if (!tenant.has_resolution) {
      add(
        'warn',
        `Numeración · ${label}`,
        'Sin resolución de facturación activa. Las ventas no obtendrán número fiscal y quedarán reintentando.',
        'POST /api/v1/dian/resolutions — ver docs/CERTIFICACION-PAC.md'
      );
    } else {
      const remaining = Number(tenant.remaining ?? 0);
      const daysLeft = tenant.valid_until
        ? Math.floor((new Date(`${tenant.valid_until}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)
        : 0;

      if (remaining <= 0) {
        add('error', `Numeración · ${label}`, 'Rango agotado: el comercio no puede facturar.', 'Solicitar rango nuevo a la DIAN.');
      } else if (daysLeft < 0) {
        add('error', `Numeración · ${label}`, `Resolución vencida el ${tenant.valid_until}.`, 'Solicitar resolución nueva.');
      } else if (remaining < 500 || daysLeft <= 30) {
        add('warn', `Numeración · ${label}`, `Quedan ${remaining} números y ${daysLeft} días de vigencia.`);
      } else {
        add('ok', `Numeración · ${label}`, `${remaining} números libres, vence en ${daysLeft} días.`);
      }
    }

    // Meseros: los dos motivos por los que «no aparece ningún mesero para asignar».
    if (tenant.enable_waiters) {
      const count = Number(tenant.waiters);
      if (count === 0) {
        add(
          'warn',
          `Meseros · ${label}`,
          'El módulo está activo pero no hay ningún mesero activo en la plantilla. El selector al abrir mesa saldrá vacío.',
          'Agrégalos en la pantalla Meseros. Crear usuarios con rol WAITER no los añade a esa lista.'
        );
      } else {
        add('ok', `Meseros · ${label}`, `${count} meseros activos.`);
      }
    } else if (tenant.enable_tables) {
      add(
        'ok',
        `Meseros · ${label}`,
        'Módulo de meseros desactivado: las mesas se abren sin asignar mesero (comportamiento correcto).'
      );
    }
  }

  // ── Documentos fiscales sin cerrar ─────────────────────────────────────────────────
  const stuck = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM dian_documents
    WHERE status IN ('PENDING', 'SENT') AND updated_at < NOW() - INTERVAL '6 hours'
  `
    .execute(admin)
    .then((r) => Number(r.rows[0]?.n ?? 0))
    .catch(() => 0);

  if (stuck > 0) {
    add(
      'warn',
      'Documentos DIAN',
      `${stuck} documentos llevan más de 6 horas sin resolverse.`,
      'Ver docs/RUNBOOK.md → «Documentos que no cierran».'
    );
  } else {
    add('ok', 'Documentos DIAN', 'Ninguno atascado.');
  }

  await admin.destroy();

  // ── Salida ─────────────────────────────────────────────────────────────────────────
  const icon: Record<Level, string> = { ok: '  OK  ', warn: ' AVISO', error: ' FALLA' };

  console.log('\nRevisión del despliegue\n' + '─'.repeat(70));
  for (const check of results) {
    console.log(`[${icon[check.level]}] ${check.title}`);
    console.log(`         ${check.detail}`);
    if (check.fix) console.log(`         → ${check.fix}`);
  }

  const errors = results.filter((r) => r.level === 'error').length;
  const warnings = results.filter((r) => r.level === 'warn').length;

  console.log('─'.repeat(70));
  console.log(`${errors} fallas · ${warnings} avisos · ${results.length - errors - warnings} correctos\n`);

  // Código de salida distinto de cero solo con fallas, para poder usarlo en un despliegue.
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('La revisión no pudo completarse:', error);
  process.exit(1);
});
