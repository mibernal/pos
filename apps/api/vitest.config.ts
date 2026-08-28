import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false
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
