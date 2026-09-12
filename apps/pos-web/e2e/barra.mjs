// Cuánto alto se lleva la barra, y si «Más» lleva a donde dice.
import { chromium } from '@playwright/test';

const navegador = await chromium.launch();

for (const ancho of [1280, 1440, 1920]) {
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
  await page.waitForTimeout(800);

  const alto = await page.evaluate(() =>
    Math.round(document.querySelector('header')?.getBoundingClientRect().height ?? 0)
  );
  const visibles = await page.locator('.topbar-nav .nav-btn').count();
  console.log(`${ancho}px · barra ${alto}px · ${visibles} botones a la vista (${Math.round((alto / 900) * 100)}% del alto)`);

  if (ancho === 1440) {
    // Toda ruta tiene que ser alcanzable de un solo clic desde la barra.
    await page.getByRole('button', { name: 'Reportes', exact: true }).click();
    await page.waitForTimeout(1500);
    console.log('  «Reportes» de un clic →', new URL(page.url()).pathname);
    await page.screenshot({ path: '/tmp/capturas-pos/barra-reportes.png' });
  }

  await ctx.close();
}

await navegador.close();
