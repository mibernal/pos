import { vi } from 'vitest';
import { configure } from '@testing-library/react';

// El árbol de la app es grande y la hidratación de sesión ocurre tras montar:
// el umbral por defecto de 1 s de Testing Library convierte eso en fallos
// intermitentes según la carga de la máquina.
configure({ asyncUtilTimeout: 5000 });

import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// jsdom no calcula layout: sin esto los contenedores miden 0 y las rejillas que se
// dimensionan a sí mismas se renderizan vacías. El doble reporta un ancho de escritorio
// para que el catálogo se comporte como en pantalla.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Por la misma razón, el virtualizador cree que no hay alto visible y no emite filas.
// El doble entrega todas: las pruebas necesitan ver las tarjetas de producto.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => {
    const size = estimateSize();
    return {
      getTotalSize: () => count * size,
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * size,
          end: (index + 1) * size,
          size,
          lane: 0
        })),
      measureElement: () => undefined,
      scrollToIndex: () => undefined,
      scrollToOffset: () => undefined
    };
  }
}));

// Mock window.location.reload to avoid "Not implemented" errors in JSDOM
Object.defineProperty(window, 'location', {
  value: {
    ...window.location,
    reload: () => {},
  },
  writable: true,
});

import { randomUUID } from 'node:crypto';

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: randomUUID
    }
  });
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  globalThis.crypto.randomUUID = randomUUID;
}

// La app pide /auth/refresh al montar y no pinta nada hasta que esa promesa se resuelve.
// Sin un doble, jsdom intenta una petición real a una URL relativa y tarda uno o dos
// segundos en fallar: cada prueba que mira la pantalla inicial quedaba a merced de ese
// tiempo. El doble por defecto responde 401 (sesión inexistente) de forma inmediata;
// las pruebas que necesitan otra cosa siguen pudiendo espiar `fetch` y sobrescribirlo.
const defaultFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
  if (url.includes('/auth/refresh')) {
    return new Response(JSON.stringify({ message: 'No autorizado' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({}), {
    status: 404,
    headers: { 'content-type': 'application/json' }
  });
};

globalThis.fetch = defaultFetch as typeof globalThis.fetch;
