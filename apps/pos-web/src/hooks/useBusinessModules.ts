import { useMemo } from 'react';
import { getEnabledModules, type BusinessType, type BusinessModule } from '@pos-dian/shared';
import { useSession } from '../features/auth';

/**
 * Hook to get the currently enabled business modules for the tenant.
 * Uses the JWT claims to determine the business type and capabilities.
 */
export function useBusinessModules() {
  const { session } = useSession();

  const enabledModules = useMemo(() => {
    if (!session?.user) return new Set<BusinessModule>();

    const businessType = (session.user.businessType as BusinessType) || 'OTHER';
    const enableTables = session.user.enableTables || false;

    const modules = getEnabledModules(businessType, enableTables);
    return new Set(modules);
  }, [session?.user]);

  const hasModule = (module: BusinessModule) => enabledModules.has(module);

  return {
    enabledModules,
    hasModule,
    isRestaurantNative: session?.user?.businessType ? ['RESTAURANT', 'CAFETERIA', 'BAR', 'NIGHTCLUB'].includes(session.user.businessType) : false
  };
}
