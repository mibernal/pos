import { expect, test, type Page } from '@playwright/test';

/**
 * Que la aplicación quepa en la pantalla en la que se usa.
 *
 * Un POS no se usa en un monitor de 27 pulgadas: se usa en una tablet de salón, a veces en
 * un teléfono, y casi siempre con el dedo. Un desbordamiento horizontal ahí no es un
 * detalle estético — obliga a arrastrar la interfaz de lado para encontrar el botón de
 * cobrar, con un cliente esperando.
 *
 * Esta prueba existe porque el fallo apareció de verdad: el armazón es un grid y sus hijos
 * nacían con `min-width: auto`, así que la columna se dimensionaba al contenido más ancho y
 * la barra superior crecía 203 px más que un móvil de 375. No se veía leyendo el CSS; se
 * vio midiendo.
 *
 * Se mide el documento entero, no cada componente: tablas y diagramas pueden y deben
 * desplazarse dentro de su propio contenedor, y eso no cuenta como desbordar.
 */

const CORREO = process.env.E2E_EMAIL ?? 'admin@demo.posdian.local';
const CLAVE = process.env.E2E_PASSWORD ?? 'Password123*';

const ANCHOS = [
  { nombre: 'teléfono', ancho: 375, alto: 812 },
  { nombre: 'tablet vertical', ancho: 768, alto: 1024 },
  { nombre: 'tablet horizontal', ancho: 1024, alto: 768 }
];

const PANTALLAS = ['/pos', '/tables', '/products', '/history', '/reports', '/customers', '/inventory'];

async function entrar(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('nombre@ejemplo.com').fill(CORREO);
  await page.getByPlaceholder('••••••••').fill(CLAVE);
  await page.getByRole('button', { name: /iniciar sesión|entrar/i }).click();

  const sucursal = page.getByRole('button', { name: /Seleccionar sucursal/i }).first();
  await sucursal.waitFor({ state: 'visible', timeout: 30_000 });
  await sucursal.click();

  const caja = page.getByRole('button', { name: /Abierta/i }).first();
  await caja.waitFor({ state: 'visible', timeout: 30_000 });
  await caja.click();

  const abrirCaja = page.getByRole('button', { name: /Abrir Caja y Comenzar/i });
  const continuar = page.getByRole('button', { name: /Continuar al Punto de Venta/i });
  await expect(abrirCaja.or(continuar).first()).toBeVisible({ timeout: 30_000 });
  if (await abrirCaja.isVisible()) await abrirCaja.click();
  if (await continuar.isVisible()) await continuar.click();

  // No se espera al botón «POS»: por debajo de cierto ancho la navegación colapsa en un
  // menú y ese botón no existe hasta abrirlo. La barra superior sí está en todos los anchos.
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30_000 });
}

/** Lo que sobresale del ancho del documento, y quién lo provoca. */
async function desbordeHorizontal(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sobra = doc.scrollWidth - doc.clientWidth;
    if (sobra <= 1) return { sobra, culpables: [] as string[] };

    const culpables: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      if (caja.right <= doc.clientWidth + 1) continue;

      // Solo el desbordador más externo de cada rama: si el padre ya se sale, el hijo sobra.
      const padre = el.parentElement?.getBoundingClientRect();
      if (padre && padre.right > doc.clientWidth + 1) continue;

      const clases = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      culpables.push(`${el.tagName.toLowerCase()}${clases ? '.' + clases : ''} (ancho ${Math.round(caja.width)})`);
      if (culpables.length >= 5) break;
    }
    return { sobra, culpables };
  });
}

for (const medida of ANCHOS) {
  test.describe(`${medida.nombre} · ${medida.ancho}px`, () => {
    test.use({ viewport: { width: medida.ancho, height: medida.alto } });

    test('ninguna pantalla obliga a desplazarse de lado', async ({ page }) => {
      await entrar(page);

      const fallos: string[] = [];

      // El primer pintado cuenta: es donde apareció el fallo original, y es lo primero
      // que ve el cajero al entrar.
      const alEntrar = await desbordeHorizontal(page);
      if (alEntrar.sobra > 1) {
        fallos.push(`al entrar: ${alEntrar.sobra}px → ${alEntrar.culpables.join(' | ')}`);
      }

      for (const ruta of PANTALLAS) {
        await page.goto(ruta);
        await expect(page.locator('header').first()).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(1200);

        const medido = await desbordeHorizontal(page);
        if (medido.sobra > 1) {
          fallos.push(`${ruta}: ${medido.sobra}px → ${medido.culpables.join(' | ')}`);
        }
      }

      expect(fallos, `Pantallas que se salen del ancho de ${medida.ancho}px:\n${fallos.join('\n')}`).toEqual([]);
    });
  });
}
