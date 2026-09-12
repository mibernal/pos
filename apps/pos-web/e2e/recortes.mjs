// El punto ciego de la sonda: lo que recorta su propio panel.
//
// `responsive.spec.ts` mide dos cosas: si el documento se desplaza de lado, y si un control
// cae fuera de la ventana. Ninguna de las dos ve el tercer caso: un elemento cuyo contenido
// es más ancho que su caja y que NO puede desplazarse. Eso no desborda el documento y no
// saca nada de la ventana — simplemente corta, sin barra, dentro del panel.
import { chromium } from '@playwright/test';

const ANCHOS = [375, 414, 768, 1024, 1280, 1440];

const navegador = await chromium.launch();

for (const ancho of ANCHOS) {
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

  const enlace = page.getByRole('button', { name: 'Historial', exact: true });
  if (!(await enlace.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Abrir menú/i }).click();
  }
  await enlace.click();
  await page.waitForTimeout(1500);

  // Selecciona una venta: el panel de detalle solo existe con una venta elegida.
  const fila = page.locator('.sale-row').first();
  if (await fila.isVisible().catch(() => false)) {
    await fila.click();
    await page.waitForTimeout(800);
  }

  const hallazgos = await page.evaluate(() => {
    const esDesplazable = (el) => {
      const o = getComputedStyle(el).overflowX;
      return o === 'auto' || o === 'scroll';
    };

    const recortados = [];
    for (const el of document.querySelectorAll('body *')) {
      const caja = el.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      const sobra = el.scrollWidth - el.clientWidth;
      if (sobra <= 1) continue;
      if (esDesplazable(el)) continue; // se alcanza arrastrando: legítimo
      const clases = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      recortados.push(`${el.tagName.toLowerCase()}${clases ? '.' + clases : ''} corta ${sobra}px (caja ${Math.round(caja.width)})`);
    }

    // Y los controles tapados por la caja de algún antepasado que no se desplaza.
    const tapados = [];
    for (const c of document.querySelectorAll('button, a[href], select, input')) {
      const caja = c.getBoundingClientRect();
      if (caja.width === 0 || caja.height === 0) continue;
      for (let p = c.parentElement; p && p !== document.body; p = p.parentElement) {
        const est = getComputedStyle(p);
        if (est.overflowX === 'visible' && est.overflowY === 'visible') continue;
        if (esDesplazable(p)) continue;
        const pc = p.getBoundingClientRect();
        if (caja.right > pc.right + 1 || caja.left < pc.left - 1) {
          const texto = (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) || c.tagName.toLowerCase();
          const pclases = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : '';
          tapados.push(`«${texto}» lo tapa .${pclases}`);
          break;
        }
      }
    }

    return { recortados: [...new Set(recortados)].slice(0, 10), tapados: [...new Set(tapados)].slice(0, 10) };
  });

  console.log(`\n=== ${ancho}px · /history ===`);
  console.log('  recortan sin barra:', hallazgos.recortados.length ? hallazgos.recortados.join('\n     ') : 'nada');
  console.log('  controles tapados :', hallazgos.tapados.length ? hallazgos.tapados.join('\n     ') : 'nada');

  await page.screenshot({ path: `/tmp/capturas-pos/hist-${ancho}.png`, fullPage: false });
  await ctx.close();
}

await navegador.close();
