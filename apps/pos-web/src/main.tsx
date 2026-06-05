import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

// Solicitar almacenamiento persistente para evitar evicción de la cola offline en móviles
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persistent) => {
    if (persistent) {
      console.log('Almacenamiento persistente concedido.');
    } else {
      console.warn('Almacenamiento persistente denegado. La cola offline podría ser purgada por el SO si hay poca memoria.');
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
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
