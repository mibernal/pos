import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node'
  },
  resolve: {
    // Las subrutas se importan con extensión `.js` (obligatorio en ESM/NodeNext), pero en
    // el árbol de fuentes el archivo es `.ts`. Sin esta reescritura, cualquier import de
    // subruta que NO sea `import type` falla al resolverse en los tests.
    alias: [
      { find: /^@pos-dian\/shared$/, replacement: resolve(__dirname, '../../packages/shared/src/index.ts') },
      { find: /^@pos-dian\/shared\/(.*)\.js$/, replacement: resolve(__dirname, '../../packages/shared/src/$1.ts') },
      { find: /^@pos-dian\/shared\/(.*)$/, replacement: resolve(__dirname, '../../packages/shared/src/$1') },
      // El worker importa del API por subruta (`@pos-dian/api/src/...js`). En ejecución lo
      // resuelve la copia `file:` que instala pnpm; en los tests hay que apuntar al árbol de
      // fuentes, o el `.js` del import no encuentra el `.ts` del repositorio.
      { find: /^@pos-dian\/api\/(.*)\.js$/, replacement: resolve(__dirname, '../api/$1.ts') },
      { find: /^@pos-dian\/api\/(.*)$/, replacement: resolve(__dirname, '../api/$1') }
    ]
  }
});
