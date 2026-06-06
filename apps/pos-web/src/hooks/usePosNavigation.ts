import { useCallback, useState } from 'react';
import { APP_ROUTE_DEFINITIONS } from '../app/routes';
import type { AppRoute } from '../types';

export function usePosNavigation(user: { role?: string; permissions?: string[] } | null, initialRoute: AppRoute = 'pos') {
  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';
  const isTenantAdmin = user?.role === 'ADMIN' || user?.role === 'TENANT_OWNER';
  
  const allowedRoutes = APP_ROUTE_DEFINITIONS.filter(r => {
    // PLATFORM_OWNER solo ve la vista global de plataforma
    if (isPlatformOwner) {
      return r.id === 'platform';
    }

    // TENANT ADMIN / OWNER ve todo EXCEPTO la vista global de plataforma
    // Su gestión de suscripción la hacen en 'billing'
    if (isTenantAdmin) {
      return r.id !== 'platform';
    }
    
    if (!r.requiredPermissions) return true;
    return user?.permissions && r.requiredPermissions.some(p => user.permissions?.includes(p));
  });
  
  // If the initial route is not allowed, default to the first allowed route
  let defaultRoute = allowedRoutes.find(r => r.id === initialRoute) ? initialRoute : allowedRoutes[0]?.id ?? 'pos';
  
  if (isPlatformOwner) {
    defaultRoute = 'platform';
  }
  
  const [activeRoute, setActiveRoute] = useState<AppRoute>(defaultRoute);

  const navigate = useCallback((route: AppRoute) => {
    setActiveRoute(route);
  }, []);

  const resetNavigation = useCallback(() => {
    setActiveRoute(defaultRoute);
  }, [defaultRoute]);

  return {
    activeRoute,
    navigate,
    resetNavigation,
    routeDefinitions: allowedRoutes
  };
}
