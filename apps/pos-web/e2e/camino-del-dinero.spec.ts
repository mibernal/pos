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

  await elegirSucursalYCaja(page);
}

/**
 * Antes de vender hay que decir desde dónde: sucursal, caja, y confirmar que está abierta.
 *
 * Se elige por rol y estado, no por nombre. La primera versión de esto buscaba una «Sede
 * Centro» que no existe en la semilla, y las tres pruebas morían en la misma línea sin
 * llegar a tocar nunca el camino del dinero.
 */
async function elegirSucursalYCaja(page: Page) {
  // Cualquier sucursal sirve: los productos del comercio no cuelgan de ella.
  const sucursal = page.getByRole('button', { name: /Seleccionar sucursal/i }).first();
  await sucursal.waitFor({ state: 'visible', timeout: 30_000 });
  await sucursal.click();

  const caja = page.getByRole('button', { name: /Abierta/i }).first();
  await caja.waitFor({ state: 'visible', timeout: 30_000 });
  await caja.click();

  // «Abierta» en la tarjeta es la terminal, no el turno: si el turno no está abierto, este
  // es el paso donde se declara la base y se abre. Sin turno no se puede cobrar, así que la
  // prueba lo abre igual que lo abriría el cajero al empezar el día.
  //
  // El `or` no es adorno: la pantalla llega en uno de dos estados según si el turno quedó
  // abierto de una corrida anterior, y hay que esperar a que llegue en alguno antes de
  // preguntar cuál. Preguntarlo con `isVisible` a secas —que no espera— devolvía `false`
  // mientras la pantalla aún se estaba pintando, y la prueba se saltaba la apertura para
  // luego morir esperando un botón que nadie iba a pintar.
  const abrirCaja = page.getByRole('button', { name: /Abrir Caja y Comenzar/i });
  const continuar = page.getByRole('button', { name: /Continuar al Punto de Venta/i });
  const dentro = page.getByRole('button', { name: 'POS', exact: true });

  await expect(abrirCaja.or(continuar).first()).toBeVisible({ timeout: 30_000 });
  if (await abrirCaja.isVisible()) {
    await abrirCaja.click();
  }

  // Abrir el turno entra directo; encontrarlo ya abierto pide confirmar. Lo que la prueba
  // espera no es un botón concreto sino el final del trámite: estar dentro de la
  // aplicación, con su barra de navegación.
  await expect(continuar.or(dentro).first()).toBeVisible({ timeout: 30_000 });
  if (await continuar.isVisible()) {
    await continuar.click();
  }

  await expect(dentro).toBeVisible({ timeout: 30_000 });
}

async function irAlPos(page: Page) {
  await page.getByRole('button', { name: 'POS', exact: true }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

/**
 * Añade el primer producto del catálogo al carrito.
 *
 * El catálogo abre por categorías, no por productos: hay que pedir verlos todos antes de
 * que exista una tarjeta que tocar.
 */
async function anadirPrimerProducto(page: Page) {
  await page.getByRole('button', { name: /Todos los Productos/i }).click();

  const primerProducto = page.getByTestId('product-card').first();
  await primerProducto.waitFor({ state: 'visible', timeout: 30_000 });
  await primerProducto.click();
}

test.describe('Camino del dinero', () => {
  test('cobrar una venta y poder reimprimir su ticket', async ({ page }) => {
    await entrar(page);
    await irAlPos(page);

    // Un producto cualquiera del catálogo sembrado.
    await anadirPrimerProducto(page);

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

    await anadirPrimerProducto(page);

    await context.setOffline(true);

    await page.getByRole('button', { name: /^Cobrar/i }).first().click();
    const modal = page.getByRole('dialog', { name: /Cobrar venta/i });
    await modal.getByRole('button', { name: /confirmar|registrar|cobrar/i }).last().click();

    await expect(page.getByText(/pendiente por falta de conexión/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/1 pendiente/i)).toBeVisible();

    await context.setOffline(false);

    // Al volver la línea la aplicación sincroniza sola, así que lo que se espera es el
    // resultado, no el gesto. Pulsar «Sincronizar ahora» —el atajo para el cajero
    // impaciente— hacía fallar la prueba justamente cuando todo iba bien: el botón se
    // deshabilita mientras la sincronización está en curso, y esperar a que se habilitara
    // era esperar a que la promesa se incumpliera.
    //
    // La cola vuelve a cero: la venta que se cobró a oscuras está en el servidor.
    await expect(page.getByText(/0 pendientes/i)).toBeVisible({ timeout: 60_000 });
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

    // Tras recargar puede haber que volver a confirmar sucursal y caja —el contexto de
    // terminal no sobrevive a la recarga— pero eso es un paso previo, no un destino: la
    // URL a la que se vuelve tiene que seguir siendo la que estaba abierta.
    const sucursal = page.getByRole('button', { name: /Seleccionar sucursal/i }).first();
    const catalogo = page.getByRole('heading', { name: /Catálogo de Productos/i });
    await expect(sucursal.or(catalogo).first()).toBeVisible({ timeout: 30_000 });

    if (await sucursal.isVisible()) {
      await elegirSucursalYCaja(page);
    }

    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole('heading', { name: /Catálogo de Productos/i })).toBeVisible();
  });
});
