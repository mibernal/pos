import { useCallback, useState } from 'react';
import { APP_ROUTE_DEFINITIONS } from '../app/routes';
import type { AppRoute } from '../types';

export function usePosNavigation(user: { role?: string; permissions?: string[] } | null, initialRoute: AppRoute = 'pos') {
  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';
  const isTenantAdmin = user?.role === 'ADMIN' || user?.role === 'TENANT_OWNER';
  
  const allowedRoutes = APP_ROUTE_DEFINITIONS.filter(r => {
    if (!r.requiredPermissions) return true;
    
    const hasPlatformPerms = r.requiredPermissions.some(p => p.startsWith('platform:'));
    const isBypassRole = isPlatformOwner || (isTenantAdmin && !hasPlatformPerms);
    
    if (isBypassRole) return true;
    
    return user?.permissions && r.requiredPermissions.some(p => user.permissions?.includes(p));
  });
  
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
