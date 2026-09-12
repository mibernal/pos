import { expect, test, type Page } from '@playwright/test';

/**
 * Que se vea lo que hay que tocar, en la pantalla en la que se usa.
 *
 * Esta prueba nació midiendo el desbordamiento del documento y no servía para nada, por
 * dos errores que conviene dejar escritos porque son fáciles de repetir:
 *
 * Uno: navegaba con `page.goto`, que recarga la página. El contexto de caja vive en
 * memoria, así que cada recarga devolvía a «Selecciona una Sucursal» — es decir, medía la
 * pantalla de apertura creyendo medir siete pantallas distintas. Aquí se navega pulsando,
 * como navega un cajero.
 *
 * Dos: solo miraba si el documento se desplazaba de lado. El historial no desbordaba el
 * documento; recortaba dentro de un panel con `overflow: hidden`, y el botón «Devolver» de
 * cada venta quedaba fuera de la ventana sin barra que lo delatara. Un control invisible no
 * produce desbordamiento: produce una función que el usuario jura que no existe.
 *
 * Y el historial solo falla con datos: vacío cabe en cualquier ancho. Por eso la prueba
 * cobra una venta antes de mirarlo.
 */

const CORREO = process.env.E2E_EMAIL ?? 'admin@demo.posdian.local';
const CLAVE = process.env.E2E_PASSWORD ?? 'Password123*';

/** Incluye los anchos de dos columnas, que es donde vivía el defecto del historial. */
const ANCHOS = [
  { nombre: 'teléfono', ancho: 375, alto: 812 },
  { nombre: 'tablet vertical', ancho: 768, alto: 1024 },
  { nombre: 'tablet horizontal', ancho: 1024, alto: 768 },
  { nombre: 'portátil', ancho: 1280, alto: 800 },
  { nombre: 'escritorio', ancho: 1440, alto: 900 }
];

const PANTALLAS = ['POS', 'Historial', 'Productos', 'Clientes', 'Inventario', 'Reportes'];

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

  await expect(page.locator('header').first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Va a una pantalla sin recargar, por donde llegaría una persona.
 *
 * Dos caminos según el ancho, y ninguno es «la URL»: por debajo de 1024 px la navegación
 * vive en un cajón; por encima, todas las rutas están en la barra.
 */
async function irA(page: Page, nombre: string) {
  const enBarra = page.getByRole('button', { name: nombre, exact: true });
  if (await enBarra.isVisible().catch(() => false)) {
    await enBarra.click();
    await page.waitForTimeout(1500);
    return;
  }

  // El emoji es el contenido; «Abrir menú» es el nombre accesible. Se busca por el nombre.
  const cajon = page.getByRole('button', { name: /Abrir menú/i });
  await cajon.waitFor({ state: 'visible', timeout: 15_000 });
  await cajon.click();
  const enCajon = page.getByRole('button', { name: nombre, exact: true });
  await enCajon.waitFor({ state: 'visible', timeout: 15_000 });
  await enCajon.click();
  await page.waitForTimeout(1500);
}

/** Deja una venta de hoy: el historial vacío cabe en cualquier ancho y no prueba nada. */
async function cobrarUnaVenta(page: Page) {
  await irA(page, 'POS');
  const todos = page.getByRole('button', { name: /Todos los Productos/i });
  if (!(await todos.isVisible().catch(() => false))) return;
  await todos.click();

  const producto = page.getByTestId('product-card').first();
  await producto.waitFor({ state: 'visible', timeout: 20_000 });
  await producto.click();

  await page.getByRole('button', { name: /^Cobrar/i }).first().click();
  const modal = page.getByRole('dialog', { name: /Cobrar venta/i });
  await modal.waitFor({ state: 'visible', timeout: 20_000 });
  await modal.getByRole('button', { name: /confirmar|registrar|cobrar/i }).last().click();
  await expect(page.getByText(/Venta #\d+ registrada/i)).toBeVisible({ timeout: 30_000 });
}

/**
 * Los dos modos de fallo: lo que obliga a desplazarse de lado, y lo que no se puede tocar
 * porque quedó fuera de la ventana.
 */
async function loQueNoSeVe(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sobra = doc.scrollWidth - doc.clientWidth;

    const desbordadores: string[] = [];
    if (sobra > 1) {
      for (const el of document.querySelectorAll('body *')) {
        const caja = el.getBoundingClientRect();
        if (caja.width === 0 || caja.height === 0) continue;
        if (caja.right <= doc.clientWidth + 1) continue;
        const padre = el.parentElement?.getBoundingClientRect();
        if (padre && padre.right > doc.clientWidth + 1) continue;
        const clases = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
        desbordadores.push(`${el.tagName.toLowerCase()}${clases ? '.' + clases : ''} (${Math.round(caja.width)}px)`);
        if (desbordadores.length >= 4) break;
      }
    }

    /**
     * Un control metido en una tira que se desplaza de lado sí se alcanza: se arrastra.
     * Es un patrón legítimo —las pestañas de Reportes lo usan— y confundirlo con un
     * recorte llevaría a «arreglar» un diseño correcto para contentar a la prueba.
     * Lo que no se alcanza es lo que quedó fuera sin que nada pueda traerlo.
     */
    const seAlcanzaDesplazando = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.scrollWidth <= p.clientWidth + 1) continue;
        const overflowX = getComputedStyle(p).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') return true;
      }
      return false;
    };

    /**
     * Un panel cerrado que se aparta con `translate-x-full` sigue teniendo coordenadas
     * fuera de la ventana, pero no es un control perdido: es un cajón cerrado. La
     * diferencia entre las dos cosas no está en dónde cae, sino en si la página lo
     * ofrece — y eso lo dicen `inert` y `aria-hidden`, que también son lo que mira un
     * lector de pantalla. Si no está marcado, cuenta como perdido.
     */
    const estaRetirado = (el: Element) =>
      el.closest('[inert], [aria-hidden="true"]') !== null;

    const inalcanzables: string[] = [];
    for (const control of document.querySelectorAll('button, a[href], [role="button"], select, input')) {
      const caja = control.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      if (caja.right <= doc.clientWidth + 1 && caja.left >= -1) continue;
      if (estaRetirado(control)) continue;
      if (seAlcanzaDesplazando(control)) continue;
      const texto = (control.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      inalcanzables.push(texto || control.getAttribute('aria-label') || control.tagName.toLowerCase());
    }

    return { sobra, desbordadores, inalcanzables: [...new Set(inalcanzables)] };
  });
}

for (const medida of ANCHOS) {
  test.describe(`${medida.nombre} · ${medida.ancho}px`, () => {
    test.use({ viewport: { width: medida.ancho, height: medida.alto } });

    test('no hay nada fuera de la pantalla', async ({ page }) => {
      await entrar(page);
      await cobrarUnaVenta(page);

      const fallos: string[] = [];

      for (const pantalla of PANTALLAS) {
        await irA(page, pantalla);
        const medido = await loQueNoSeVe(page);

        if (medido.sobra > 1) {
          fallos.push(`${pantalla}: obliga a desplazarse ${medido.sobra}px → ${medido.desbordadores.join(' | ')}`);
        }
        if (medido.inalcanzables.length > 0) {
          fallos.push(`${pantalla}: controles fuera de la ventana → ${medido.inalcanzables.join(', ')}`);
        }
      }

      expect(fallos, `A ${medida.ancho}px:\n${fallos.join('\n')}`).toEqual([]);
    });
  });
}
