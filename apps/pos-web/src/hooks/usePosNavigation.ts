import { useCallback, useState } from 'react';
import { APP_ROUTE_DEFINITIONS, type EnhancedRouteDefinition } from '../app/routes';
import type { AppRoute } from '../types';
import { useBusinessModules } from './useBusinessModules';

export function usePosNavigation(user: { role?: string; permissions?: string[] } | null) {
  const { hasModule } = useBusinessModules();
  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';
  const isTenantAdmin = user?.role === 'ADMIN' || user?.role === 'TENANT_OWNER';
  
  const allowedRoutes = APP_ROUTE_DEFINITIONS.filter(r => {
    // PLATFORM_OWNER solo ve la vista global de plataforma
    if (isPlatformOwner) {
      return r.id === 'platform';
    }

    // TENANT ADMIN / OWNER ve todo EXCEPTO la vista global de plataforma, pero respetando los módulos habilitados
    if (isTenantAdmin) {
      if (r.id === 'platform') return false;
      if ((r as EnhancedRouteDefinition).requiredModule && !hasModule((r as EnhancedRouteDefinition).requiredModule!)) return false;
      return true;
    }
    
    if (!r.requiredPermissions) {
      if ((r as EnhancedRouteDefinition).requiredModule && !hasModule((r as EnhancedRouteDefinition).requiredModule!)) return false;
      return true;
    }
    
    const hasPerms = user?.permissions && r.requiredPermissions.some(p => user.permissions?.includes(p));
    if (!hasPerms) return false;
    
    if ((r as EnhancedRouteDefinition).requiredModule && !hasModule((r as EnhancedRouteDefinition).requiredModule!)) return false;
    
    return true;
  });
  
  // Si tiene el módulo TABLES, priorizamos 'tables' como ruta por defecto, sino 'pos'
  const targetDefault = hasModule('tables') ? 'tables' : 'pos';
  let defaultRoute = allowedRoutes.find(r => r.id === targetDefault) ? targetDefault : allowedRoutes[0]?.id ?? 'pos';
  
  if (isPlatformOwner) {
    defaultRoute = 'platform';
  }
  
  const [activeRouteState, setActiveRoute] = useState<AppRoute>(defaultRoute);
  const activeRoute = allowedRoutes.find(r => r.id === activeRouteState) ? activeRouteState : defaultRoute;

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
