import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
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
  /**
   * `vite preview` sirve el build de producción, y es contra eso que corre el e2e del camino
   * del dinero. Necesita el mismo proxy que el servidor de desarrollo: sin él, la PWA
   * hablaría con otro origen y haría falta abrir CORS solo para las pruebas — que es tanto
   * como probar una configuración que nadie despliega.
   */
  preview: {
    port: Number(process.env.E2E_WEB_PORT ?? 4173),
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: true }
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        configure: (proxy) => {
          // Ignorar errores EPIPE: ocurren cuando el navegador cierra una conexión SSE/WS
          // mientras el servidor aún intenta escribir en ella. Son benignos y esperados.
          proxy.on('error', (err, _req, _res) => {
            if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
              console.error('[vite:proxy] /api error:', err.message);
            }
          });
        }
      },
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, _res) => {
            if ((err as NodeJS.ErrnoException).code !== 'EPIPE') {
              console.error('[vite:proxy] /socket.io error:', err.message);
            }
          });
        }
      }
    }
  }
});
