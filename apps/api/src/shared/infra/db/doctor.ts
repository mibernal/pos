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
      'pnpm --filter @pos-dian/api db:ensure-api-role'
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
        'Si el rol no existe: pnpm --filter @pos-dian/api db:ensure-api-role'
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
    .catch((error) => {
      // Se avisa en vez de tragarse el error: esta consulta une con `dian_resolutions`, que
      // no existe hasta la migración 090. Al principio devolvía [] en silencio y la sección
      // de comercios simplemente no aparecía — el usuario se quedaba sin el diagnóstico de
      // numeración y de meseros sin saber por qué.
      add(
        'warn',
        'Configuración por comercio',
        `No se pudo revisar: ${error instanceof Error ? error.message : String(error)}`,
        'Si menciona dian_resolutions, falta aplicar la migración 090: pnpm --filter @pos-dian/api db:migrate'
      );
      return [];
    });

  if (tenants.length === 0 && !results.some((r) => r.title === 'Configuración por comercio')) {
    add('warn', 'Comercios', 'No hay ninguno activo en la base. Siembra el entorno de demo con db:seed si es una instalación nueva.');
  }

  /**
   * Los comercios se agrupan en vez de imprimir una línea por cada uno.
   *
   * La primera versión sacaba dos avisos por comercio: en una base de desarrollo con cien
   * tenants de prueba acumulados eso son 185 líneas idénticas, y un informe que nadie lee
   * es lo mismo que no tener informe. Se resume, y se nombran solo unos pocos.
   */
  const TEST_TENANT = /^(Tenant E2E |Stress Test|Tenant [AB]$|Numeración$)/;
  const real = tenants.filter((t) => !TEST_TENANT.test(t.name));
  const testOnes = tenants.filter((t) => TEST_TENANT.test(t.name));

  if (testOnes.length > 0) {
    add(
      'warn',
      'Comercios de prueba',
      `${testOnes.length} comercios con nombre de fixture (Tenant E2E…, Stress Test…) siguen en la base. ` +
        'No se revisan y ensucian los informes; suelen quedar de suites que fallaron a mitad.',
      'pnpm --filter @pos-dian/api db:doctor -- --limpiar-comercios-de-prueba'
    );
  }

  function summarize(
    title: string,
    matching: typeof real,
    level: Level,
    detail: (count: number, names: string) => string,
    fix?: string
  ): void {
    if (matching.length === 0) return;
    // Se nombran hasta tres: suficiente para saber a quién mirar, sin llenar la pantalla.
    const names = matching.slice(0, 3).map((t) => t.name).join(', ');
    const suffix = matching.length > 3 ? ` y ${matching.length - 3} más` : '';
    add(level, title, detail(matching.length, names + suffix), fix);
  }

  summarize(
    'DIAN · proveedor',
    real.filter((t) => !t.has_settings),
    'warn',
    (n, names) => `${n} comercios sin proveedor PAC en tenant_dian_settings: ${names}. No podrán emitir.`
  );

  const withoutResolution = real.filter((t) => !t.has_resolution);
  summarize(
    'Numeración · sin resolución',
    withoutResolution,
    'warn',
    (n, names) =>
      `${n} comercios sin resolución de facturación activa: ${names}. ` +
      'Sus ventas no obtendrán número fiscal y quedarán reintentando.',
    'POST /api/v1/dian/resolutions — ver docs/CERTIFICACION-PAC.md'
  );

  const withResolution = real.filter((t) => t.has_resolution);
  const daysLeftOf = (t: (typeof real)[number]) =>
    t.valid_until
      ? Math.floor((new Date(`${t.valid_until}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)
      : 0;

  summarize(
    'Numeración · rango agotado',
    withResolution.filter((t) => Number(t.remaining ?? 0) <= 0),
    'error',
    (n, names) => `${n} comercios agotaron su rango y NO pueden facturar: ${names}.`,
    'Solicitar rango nuevo a la DIAN.'
  );

  summarize(
    'Numeración · resolución vencida',
    withResolution.filter((t) => Number(t.remaining ?? 0) > 0 && daysLeftOf(t) < 0),
    'error',
    (n, names) => `${n} comercios con la resolución vencida y NO pueden facturar: ${names}.`,
    'Solicitar resolución nueva a la DIAN.'
  );

  summarize(
    'Numeración · por agotarse',
    withResolution.filter(
      (t) => Number(t.remaining ?? 0) > 0 && daysLeftOf(t) >= 0 && (Number(t.remaining ?? 0) < 500 || daysLeftOf(t) <= 30)
    ),
    'warn',
    (n, names) => `${n} comercios con poco rango o vigencia próxima a vencer: ${names}.`
  );

  const healthy = withResolution.filter(
    (t) => Number(t.remaining ?? 0) >= 500 && daysLeftOf(t) > 30
  );
  if (healthy.length > 0) {
    add('ok', 'Numeración', `${healthy.length} comercios con numeración vigente y rango suficiente.`);
  }

  // Meseros: las dos causas de «no aparece ningún mesero para asignar».
  summarize(
    'Meseros · plantilla vacía',
    real.filter((t) => t.enable_waiters && Number(t.waiters) === 0),
    'warn',
    (n, names) =>
      `${n} comercios tienen el módulo de meseros activo pero ninguno en la plantilla: ${names}. ` +
      'El selector al abrir mesa saldrá vacío.',
    'Agrégalos en la pantalla Meseros. Crear usuarios con rol WAITER no los añade a esa lista.'
  );

  const withWaiters = real.filter((t) => t.enable_waiters && Number(t.waiters) > 0);
  if (withWaiters.length > 0) {
    add(
      'ok',
      'Meseros',
      `${withWaiters.length} comercios con meseros activos: ` +
        withWaiters.map((t) => `${t.name} (${t.waiters})`).slice(0, 3).join(', ')
    );
  }

  // ── Documentos fiscales sin cerrar ─────────────────────────────────────────────────
  const stuck = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM dian_documents
    WHERE status IN ('PENDING', 'SENT') AND updated_at < NOW() - INTERVAL '6 hours'
  `
    .execute(admin)
    .then((r) => Number(r.rows[0]?.n ?? 0))
    .catch(() => -1);

  if (stuck < 0) {
    add('warn', 'Documentos DIAN', 'No se pudo consultar dian_documents.');
  } else if (stuck > 0) {
    add(
      'warn',
      'Documentos DIAN',
      `${stuck} documentos llevan más de 6 horas sin resolverse.`,
      'Ver docs/RUNBOOK.md → «Documentos que no cierran».'
    );
  } else {
    add('ok', 'Documentos DIAN', 'Ninguno atascado.');
  }

  // ── Limpieza opcional de comercios de prueba ───────────────────────────────────────
  //
  // Las suites e2e siembran un comercio por caso y lo borran al terminar; cuando una suite
  // se corta a mitad, el comercio se queda. Con el tiempo se acumulan cientos en la base de
  // desarrollo y el informe deja de ser legible.
  //
  // Solo borra los que llevan nombre de fixture, nunca uno real, y hay que pedirlo
  // explícitamente: borrar comercios no es algo que un comando de diagnóstico deba hacer
  // por su cuenta.
  if (process.argv.includes('--limpiar-comercios-de-prueba')) {
    const doomed = tenants.filter((t) => /^(Tenant E2E |Stress Test|Tenant [AB]$|Numeración$)/.test(t.name));

    if (doomed.length === 0) {
      console.log('\nNo hay comercios de prueba que borrar.\n');
    } else {
      console.log(`\nBorrando ${doomed.length} comercios de prueba…`);
      let deleted = 0;
      for (const tenant of doomed) {
        try {
          // El borrado en cascada de las claves foráneas se encarga del resto.
          await sql`DELETE FROM tenants WHERE id = ${tenant.id}`.execute(admin);
          deleted += 1;
        } catch (error) {
          console.warn(`  No se pudo borrar ${tenant.name}: ${error instanceof Error ? error.message : error}`);
        }
      }
      console.log(`Borrados ${deleted} de ${doomed.length}.\n`);
      console.log('Vuelve a ejecutar `db:doctor` sin la bandera para ver el informe limpio.\n');
      await admin.destroy();
      process.exit(0);
    }
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
