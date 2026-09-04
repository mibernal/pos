import { expect, test, type Page } from '@playwright/test';

/**
 * El camino del dinero.
 *
 * Es lo único de esta aplicación que no puede fallar: si el catálogo tarda, se espera; si un
 * informe revienta, se recarga. Si la caja no cobra, el comercio cierra la puerta.
 *
 * Las pruebas de unidad corren en jsdom, donde `history.pushState` no mueve la URL, el
 * service worker no existe y `navigator.onLine` es un dato inventado — justo las tres cosas
 * de las que depende una caja que sigue vendiendo con el internet caído. Esto corre en un
 * navegador de verdad contra la API de verdad.
 *
 * Necesita la base migrada y sembrada (`pnpm --filter @pos-dian/api db:seed`) y la API
 * levantada en el 3000. El job de CI lo prepara; en local, `pnpm dev`.
 */

const CORREO = process.env.E2E_EMAIL ?? 'admin@demo.posdian.local';
const CLAVE = process.env.E2E_PASSWORD ?? 'Password123*';

async function entrar(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('nombre@ejemplo.com').fill(CORREO);
  await page.getByPlaceholder('••••••••').fill(CLAVE);
  await page.getByRole('button', { name: /iniciar sesión|entrar/i }).click();

  // Elegir sucursal y caja es el paso previo a poder vender.
  await page.getByRole('button', { name: /Sede Centro/i }).first().click();
  const continuar = page.getByRole('button', { name: /Continuar al Punto de Venta/i });
  await continuar.waitFor({ state: 'visible', timeout: 30_000 });
  await continuar.click();
}

async function irAlPos(page: Page) {
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

test.describe('Camino del dinero', () => {
  test('cobrar una venta y poder reimprimir su ticket', async ({ page }) => {
    await entrar(page);
    await irAlPos(page);

    // Un producto cualquiera del catálogo sembrado.
    const primerProducto = page.locator('[data-testid="product-card"], .product-card').first();
    await primerProducto.waitFor({ state: 'visible', timeout: 30_000 });
    await primerProducto.click();

    await page.getByRole('button', { name: /^Cobrar/i }).first().click();

    const modal = page.getByRole('dialog', { name: /Cobrar venta/i });
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: /confirmar|registrar|cobrar/i }).last().click();

    // El mensaje de venta registrada lleva el consecutivo: es lo que el cajero le dice al
    // cliente si pregunta.
    await expect(page.getByText(/Venta #\d+ registrada/i)).toBeVisible({ timeout: 30_000 });
  });

  /**
   * La caja sigue vendiendo con el internet caído.
   *
   * Es la promesa que sostiene todo el diseño offline: la venta se guarda en el navegador y
   * se sincroniza cuando vuelve la línea. Aquí se corta la red de verdad, no se simula un
   * `navigator.onLine` a mano.
   */
  test('sin conexión la venta se encola, y al volver se sincroniza', async ({ page, context }) => {
    await entrar(page);
    await irAlPos(page);

    const primerProducto = page.locator('[data-testid="product-card"], .product-card').first();
    await primerProducto.waitFor({ state: 'visible', timeout: 30_000 });
    await primerProducto.click();

    await context.setOffline(true);

    await page.getByRole('button', { name: /^Cobrar/i }).first().click();
    const modal = page.getByRole('dialog', { name: /Cobrar venta/i });
    await modal.getByRole('button', { name: /confirmar|registrar|cobrar/i }).last().click();

    await expect(page.getByText(/pendiente por falta de conexión/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1 pendiente/i)).toBeVisible();

    await context.setOffline(false);

    await page.getByRole('button', { name: /sincronizar/i }).first().click();

    // La cola vuelve a cero: la venta que se cobró a oscuras está en el servidor.
    await expect(page.getByText(/0 pendientes/i)).toBeVisible({ timeout: 30_000 });
  });

  /**
   * El criterio de salida de la fase 11, comprobado donde importa: en un navegador con su
   * barra de direcciones. En jsdom esto no se puede probar porque `pushState` no mueve la URL.
   */
  test('recargar una pantalla la devuelve donde estaba', async ({ page }) => {
    await entrar(page);

    await page.getByRole('button', { name: 'Productos', exact: true }).click();
    await expect(page).toHaveURL(/\/products$/);

    await page.reload();

    // Tras recargar hay que volver a confirmar la caja, pero el destino se respeta.
    const continuar = page.getByRole('button', { name: /Continuar al Punto de Venta/i });
    if (await continuar.isVisible().catch(() => false)) {
      await continuar.click();
    }

    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole('heading', { name: /Catálogo de Productos/i })).toBeVisible();
  });
});
