import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false
  },
  resolve: {
    alias: {
      '@pos-dian/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@pos-dian/shared/': resolve(__dirname, '../../packages/shared/src/')
    }
  }
});
