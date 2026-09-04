import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    /**
     * `e2e/` es de Playwright, no de Vitest: sus specs importan `@playwright/test` y aquí
     * no hay navegador que los ejecute. Sin esta exclusión, Vitest los recoge y falla al
     * cargarlos.
     */
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // Montar el árbol completo de la app y esperar la hidratación de sesión
    // supera con holgura el umbral por defecto de 5 s en máquinas cargadas.
    testTimeout: 20000,
    hookTimeout: 20000
  },
  resolve: {
    // Las subrutas se importan con extensión `.js` (obligatorio en ESM/NodeNext), pero en
    // el árbol de fuentes el archivo es `.ts`. Sin esta reescritura, cualquier import de
    // subruta que NO sea `import type` falla al resolverse en los tests.
    alias: [
      { find: /^@pos-dian\/shared$/, replacement: resolve(__dirname, '../../packages/shared/src/index.ts') },
      { find: /^@pos-dian\/shared\/(.*)\.js$/, replacement: resolve(__dirname, '../../packages/shared/src/$1.ts') },
      { find: /^@pos-dian\/shared\/(.*)$/, replacement: resolve(__dirname, '../../packages/shared/src/$1') }
    ]
  }
});
