import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Ninguna migración puede conceder permisos a `api_user` sin comprobar antes que el rol
 * exista.
 *
 * `api_user` es un rol del **clúster**, no de la base: `pg_dump` no lo exporta, así que
 * restaurar un volcado en un servidor nuevo —o recrear el contenedor de Postgres— deja el
 * esquema intacto y los roles fuera. Un `GRANT … TO api_user` sin guarda revienta la
 * migración entera con `role "api_user" does not exist`, y deja la base a medio migrar.
 *
 * Pasó de verdad al desplegar la migración 090. Esta prueba es barata y evita repetirlo:
 * lee las migraciones como texto y exige que todo GRANT a `api_user` viva dentro de un
 * bloque que compruebe `pg_roles`.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Migraciones anteriores a que el rol existiera como concepto; se revisan igual. */
const GRANT_PATTERN = /GRANT[\s\S]{0,400}?\bTO\s+api_user\b/gi;
const GUARD_PATTERN = /pg_roles[\s\S]{0,200}?rolname\s*=\s*'api_user'/i;

describe('Migraciones: permisos al rol api_user', () => {
  it('todo GRANT a api_user está protegido por una comprobación de pg_roles', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.ts')).sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];

    for (const file of files) {
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const grants = content.match(GRANT_PATTERN);
      if (!grants) continue;

      // La guarda puede estar en cualquier punto del archivo: lo que importa es que la
      // migración no asuma la existencia del rol. Se comprueba a nivel de archivo porque
      // el patrón habitual es un único bloque `DO $$ … END $$` que envuelve los GRANT.
      if (!GUARD_PATTERN.test(content)) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      `Estas migraciones conceden permisos a api_user sin comprobar que exista. ` +
        `Si el rol falta —volcado restaurado, contenedor recreado— la migración falla y deja la base a medias:\n` +
        offenders.map((f) => `  - ${f}`).join('\n')
    ).toEqual([]);
  });
});
