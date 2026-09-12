// Ver con los ojos las tablas que ahora son fichas.
import { chromium } from '@playwright/test';

const navegador = await chromium.launch();

for (const [nombre, ancho] of [['telefono', 375], ['escritorio', 1440]]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: 900 } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:4173/');
  await page.getByPlaceholder('nombre@ejemplo.com').fill('admin@demo.posdian.local');
  await page.getByPlaceholder('••••••••').fill('Password123*');
  await page.getByRole('button', { name: /iniciar sesión|entrar/i }).click();
  await page.getByRole('button', { name: /Seleccionar sucursal/i }).first().click();
  await page.getByRole('button', { name: /Abierta/i }).first().click();
  const abrir = page.getByRole('button', { name: /Abrir Caja y Comenzar/i });
  const seguir = page.getByRole('button', { name: /Continuar al Punto de Venta/i });
  await abrir.or(seguir).first().waitFor({ state: 'visible', timeout: 30_000 });
  if (await abrir.isVisible()) await abrir.click();
  if (await seguir.isVisible()) await seguir.click();
  await page.locator('header').first().waitFor({ state: 'visible', timeout: 30_000 });

  const irA = async (pantalla) => {
    const enBarra = page.getByRole('button', { name: pantalla, exact: true });
    if (await enBarra.isVisible().catch(() => false)) {
      await enBarra.click();
    } else {
      await page.getByRole('button', { name: /Abrir menú/i }).click();
      await page.getByRole('button', { name: pantalla, exact: true }).click();
    }
    await page.waitForTimeout(1500);
  };

  for (const pantalla of ['Clientes', 'Inventario']) {
    await irA(pantalla);
    await page.screenshot({ path: `/tmp/capturas-pos/${nombre}-${pantalla.toLowerCase()}.png` });
  }

  await ctx.close();
}

await navegador.close();
console.log('listo');
