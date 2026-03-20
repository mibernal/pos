import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'POS DIAN',
        short_name: 'POS DIAN',
        description: 'Punto de venta offline-friendly con emisión DIAN desacoplada',
        theme_color: '#0f172a',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: '192x192',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@pos-dian/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@pos-dian/shared/': resolve(__dirname, '../../packages/shared/src/')
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});
