// Capturas para mirar con los ojos lo que la prueba mide con números.
// Uso: node e2e/capturas.mjs   (con `vite preview` y la API en pie)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const CORREO = process.env.E2E_EMAIL ?? 'admin@demo.posdian.local';
const CLAVE = process.env.E2E_PASSWORD ?? 'Password123*';
const DESTINO = '/tmp/capturas-pos';
mkdirSync(DESTINO, { recursive: true });

const navegador = await chromium.launch();

for (const [nombre, ancho, alto] of [['telefono', 375, 812], ['tablet', 768, 1024], ['escritorio', 1440, 900]]) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto } });
  const page = await ctx.newPage();

  await page.goto('http://localhost:4173/');
  await page.getByPlaceholder('nombre@ejemplo.com').fill(CORREO);
  await page.getByPlaceholder('••••••••').fill(CLAVE);
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
    const enlace = page.getByRole('button', { name: pantalla, exact: true });
    if (!(await enlace.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /Abrir menú/i }).click();
    }
    await enlace.click();
    await page.waitForTimeout(1200);
  };

  for (const pantalla of ['POS', 'Historial', 'Productos', 'Reportes']) {
    await irA(pantalla);
    await page.screenshot({ path: `${DESTINO}/${nombre}-${pantalla.toLowerCase()}.png` });
  }

  // Y el cajón abierto, que es donde ahora viven las acciones en móvil.
  if (ancho < 1024) {
    await page.getByRole('button', { name: /Abrir menú/i }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DESTINO}/${nombre}-cajon.png` });
  }

  await ctx.close();
}

await navegador.close();
console.log('listo →', DESTINO);
