import { defineConfig, devices } from '@playwright/test';

/**
 * El camino del dinero, contra la aplicación de verdad.
 *
 * Las pruebas de unidad de esta app corren en jsdom, donde `history.pushState` no mueve la
 * URL, el `Service Worker` no existe y `navigator.onLine` es un dato inventado. Justo las
 * tres cosas de las que depende una caja que sigue vendiendo cuando se cae internet. Esto
 * corre en un navegador real, contra la API real, con Postgres detrás.
 *
 * La app se sirve con `vite preview` —el `build` de producción, no el servidor de
 * desarrollo— porque lo que hay que probar es lo que se despliega: el service worker
 * precacheado y el enrutado sobre URLs reales.
 */
const PUERTO_WEB = Number(process.env.E2E_WEB_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // El camino del dinero se prueba en serie: comparten la misma caja abierta en la base.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://localhost:${PUERTO_WEB}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Solo levanta el frontend. La API y su base las levanta quien invoca —en CI, el propio
   * job; en local, `pnpm dev`— porque arrancarlas desde aquí escondería que la prueba
   * necesita una base migrada y sembrada, y ese requisito es parte de lo que se está
   * probando.
   */
  webServer: {
    command: `pnpm exec vite preview --port ${PUERTO_WEB} --strictPort`,
    url: `http://localhost:${PUERTO_WEB}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
