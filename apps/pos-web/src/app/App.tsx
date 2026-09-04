import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from '../features/auth';
import { FeatureModuleProvider } from '../features/modules';
import { AppRoutes } from './AppRoutes';

/**
 * Los proveedores, sin enrutador.
 *
 * Se exportan aparte porque en jsdom `history.pushState` no mueve `window.location`, así que
 * `BrowserRouter` no navega en las pruebas. Montarlas con `MemoryRouter` es la forma de
 * ejercer el mismo árbol con un enrutador que sí funciona ahí; lo que se prueba sigue siendo
 * la aplicación entera, no una versión recortada.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <FeatureModuleProvider>{children}</FeatureModuleProvider>
    </SessionProvider>
  );
}

/**
 * La aplicación: sesión, módulos y rutas.
 *
 * Lo que antes había aquí —una cadena de `else if` de doscientas líneas que decidía a la vez
 * qué pantalla pintar y con qué props— vive ahora repartido: el árbol en `AppRoutes`, el
 * contexto compartido en `AppShell`, y las props de cada pantalla en `route-elements`.
 */
export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
