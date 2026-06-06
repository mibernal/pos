import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

import { ApiClientError } from './lib/api';

// Solicitar almacenamiento persistente para evitar evicción de la cola offline en móviles
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {
    // Ignorar errores de solicitud de persistencia silenciosamente
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof ApiClientError && error.status === 401) {
          return false;
        }
        return failureCount < 3;
      }
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
