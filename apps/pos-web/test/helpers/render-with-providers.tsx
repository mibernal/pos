import React, { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider, SessionProvider } from '../../src/features/auth';
import { FeatureModuleProvider } from '../../src/features/modules';

/**
 * Envuelve un componente en los proveedores que la app monta en producción.
 *
 * Varias pantallas dejaron de poder renderizarse aisladas cuando pasaron a leer
 * `useModules` (que a su vez lee `useSession`). Montar los proveedores de verdad —en
 * lugar de duplicar sus contextos en cada prueba— mantiene los tests alineados con
 * cómo se comporta la app: sin sesión, ningún módulo opcional está activo.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & {
    /**
     * Cliente falso para la pantalla bajo prueba.
     *
     * Desde la fase 11 las pantallas piden el cliente con `useApi` en vez de recibirlo como
     * prop. `ApiProvider` anidado dentro del de sesión lo sustituye para este subárbol, que
     * es como una prueba inyecta su doble sin tener que simular un login entero.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    api?: any;
  }
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {options?.api ? (
            <ApiProvider client={options.api}>
              <FeatureModuleProvider>{children}</FeatureModuleProvider>
            </ApiProvider>
          ) : (
            <FeatureModuleProvider>{children}</FeatureModuleProvider>
          )}
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
