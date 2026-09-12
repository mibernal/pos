import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { ROLE_PERMISSIONS } from '../src/shared/infra/security/permissions.js';

/**
 * El catálogo tiene que alcanzar para todo lo que el código exige.
 *
 * Hasta la fase 12, `requirePermissions` dejaba pasar a `TENANT_OWNER` y `ADMIN` sin mirar
 * el catálogo. Eso hacía que una ruta nueva funcionara para ellos aunque nadie hubiera
 * declarado el permiso — y el día que se quitara el atajo, la ruta se caía sin que ninguna
 * prueba lo hubiera visto venir. Pasó: al quitarlo aparecieron tres rutas que `ADMIN` sabía
 * usar y no tenía declarado.
 *
 * Esta prueba lee las guardas del código y las compara con el catálogo. Si alguien añade
 * una ruta con un permiso nuevo y olvida dárselo a quien debe usarla, falla aquí y no en la
 * cara de un comercio.
 *
 * Ojo con el detalle de `.every()`: el guard exige **todos** los permisos de la lista, no
 * uno cualquiera. Así que aquí se comprueba lo mismo.
 */

const API_SRC = resolve(__dirname, '../src');

/** Los roles que se espera que puedan gobernar su propio comercio de punta a punta. */
const ROLES_DE_CONFIANZA = ['TENANT_OWNER', 'ADMIN'] as const;

function guardasDelCodigo(): Array<{ sitio: string; permisos: string[] }> {
  const archivos = readdirSync(API_SRC, { recursive: true, encoding: 'utf-8' }).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
  );

  const guardas: Array<{ sitio: string; permisos: string[] }> = [];
  for (const archivo of archivos) {
    const ruta = resolve(API_SRC, archivo);
    const texto = readFileSync(ruta, 'utf-8');

    for (const m of texto.matchAll(/requirePermissions\(\s*\[(.*?)\]/gs)) {
      const permisos = [...m[1]!.matchAll(/'([^']+)'/g)].map((p) => p[1]!);
      if (permisos.length === 0) continue;
      const linea = texto.slice(0, m.index).split('\n').length;
      guardas.push({ sitio: `${relative(API_SRC, ruta)}:${linea}`, permisos });
    }
  }
  return guardas;
}

describe('Catálogo de permisos', () => {
  it('encuentra las guardas del código, para que la prueba no pase por estar vacía', () => {
    // Sin esto, un cambio en la forma de declarar guardas dejaría la prueba en verde
    // comprobando exactamente nada.
    expect(guardasDelCodigo().length).toBeGreaterThan(50);
  });

  it.each(ROLES_DE_CONFIANZA)(
    '%s puede con todo lo de su comercio sin depender de ningún atajo',
    (rol) => {
      const tiene = new Set(ROLE_PERMISSIONS[rol]);
      const sinCubrir = guardasDelCodigo()
        // Los permisos de plataforma son de la casa, no del comercio: estos roles no los
        // tienen a propósito y nunca los tuvieron, ni con el atajo puesto.
        .filter(({ permisos }) => !permisos.some((p) => p.startsWith('platform:')))
        .map(({ sitio, permisos }) => ({ sitio, faltan: permisos.filter((p) => !tiene.has(p)) }))
        .filter(({ faltan }) => faltan.length > 0);

      expect(
        sinCubrir,
        `A ${rol} le faltan permisos que el código exige. O se los añades al catálogo, o ` +
          `esa ruta deja de ser suya a propósito:\n` +
          sinCubrir.map((s) => `  ${s.sitio} → ${s.faltan.join(', ')}`).join('\n')
      ).toEqual([]);
    }
  );

  it('ningún permiso exigido por una ruta se ha quedado sin dueño', () => {
    const deAlguien = new Set(Object.values(ROLE_PERMISSIONS).flat());
    const huerfanos = [
      ...new Set(guardasDelCodigo().flatMap(({ permisos }) => permisos))
    ].filter((p) => !deAlguien.has(p));

    expect(
      huerfanos,
      `Estos permisos los exige alguna ruta y no los tiene ningún rol, así que esa ruta no ` +
        `la puede usar nadie:\n  ${huerfanos.join('\n  ')}`
    ).toEqual([]);
  });
});
