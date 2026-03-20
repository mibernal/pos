import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true
  },
  resolve: {
    alias: {
      '@pos-dian/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@pos-dian/shared/': resolve(__dirname, '../../packages/shared/src/')
    }
  }
});
