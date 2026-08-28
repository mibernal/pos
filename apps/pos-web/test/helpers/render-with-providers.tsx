import React, { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from '../../src/features/auth';
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
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <FeatureModuleProvider>{children}</FeatureModuleProvider>
        </SessionProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
