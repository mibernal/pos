import { useCallback, useState } from 'react';
import { APP_ROUTE_DEFINITIONS } from '../app/routes';
import type { AppRoute } from '../types';
import type { UserRole } from '../lib/api';

export function usePosNavigation(userPermissions: string[] | null, initialRoute: AppRoute = 'pos') {
  const allowedRoutes = APP_ROUTE_DEFINITIONS.filter(r => 
    !r.requiredPermissions || 
    (userPermissions && r.requiredPermissions.some(p => userPermissions.includes(p)))
  );
  
  // If the initial route is not allowed, default to the first allowed route
  const defaultRoute = allowedRoutes.find(r => r.id === initialRoute) ? initialRoute : allowedRoutes[0]?.id ?? 'pos';
  
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
