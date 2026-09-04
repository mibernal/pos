import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_ROUTE_DEFINITIONS, pathForRoute, routeAccess, routeForPath } from '../app/routes';
import type { AppRoute } from '../types';
import { useBusinessModules } from './useBusinessModules';

/**
 * La navegación del armazón, ahora sobre la URL.
 *
 * La pantalla activa era un `useState`: recargar devolvía siempre al POS y no había forma de
 * mandarle a nadie un enlace a una pantalla concreta. Ahora la pantalla activa **es** la URL,
 * y este hook solo traduce entre el identificador de ruta —que es como hablan las pantallas
 * desde siempre— y su dirección.
 *
 * Lo que no cambia es el filtro: el menú sigue enseñando solo lo que el rol y el plan
 * permiten. Que la URL exista no significa que se pueda entrar; de eso se encarga
 * `RouteGuard`, que lee la misma definición.
 */
export function usePosNavigation(user: { role?: string; permissions?: string[] } | null) {
  const { hasModule } = useBusinessModules();
  const location = useLocation();
  const navegar = useNavigate();

  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';

  // El menú y la guarda de entrada preguntan lo mismo a la misma función: es lo que impide
  // que vuelvan a divergir.
  const allowedRoutes = useMemo(
    () => APP_ROUTE_DEFINITIONS.filter((r) => routeAccess(r, user, hasModule) === 'ok'),
    [hasModule, user]
  );

  const defaultRoute: AppRoute = useMemo(() => {
    if (isPlatformOwner) return 'platform';
    // Con mesas, el sitio natural es el salón; sin ellas, la caja.
    const preferida = hasModule('tables') ? 'tables' : 'pos';
    return allowedRoutes.some((r) => r.id === preferida) ? preferida : (allowedRoutes[0]?.id ?? 'pos');
  }, [allowedRoutes, hasModule, isPlatformOwner]);

  const rutaDeLaUrl = routeForPath(location.pathname);
  const activeRoute: AppRoute = rutaDeLaUrl ?? defaultRoute;

  const navigate = useCallback((route: AppRoute) => navegar(pathForRoute(route)), [navegar]);
  const resetNavigation = useCallback(() => navegar(pathForRoute(defaultRoute)), [navegar, defaultRoute]);

  return {
    activeRoute,
    navigate,
    resetNavigation,
    defaultRoute,
    routeDefinitions: allowedRoutes
  };
}
