import { useCallback, useState } from 'react';
import { APP_ROUTE_DEFINITIONS } from '../app/routes';
import type { AppRoute } from '../types';

export function usePosNavigation(initialRoute: AppRoute = 'pos') {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(initialRoute);

  const navigate = useCallback((route: AppRoute) => {
    setActiveRoute(route);
  }, []);

  const resetNavigation = useCallback(() => {
    setActiveRoute('pos');
  }, []);

  return {
    activeRoute,
    navigate,
    resetNavigation,
    routeDefinitions: APP_ROUTE_DEFINITIONS
  };
}
