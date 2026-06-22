import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { BusinessModule } from '@pos-dian/shared';
import { useSession } from '../auth';

export type FeatureModuleContextType = {
  hasModule: (module: BusinessModule) => boolean;
  enabledModules: Set<BusinessModule>;
  isRestaurantNative: boolean;
};

const FeatureModuleContext = createContext<FeatureModuleContextType | null>(null);

export function FeatureModuleProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();

  const value = useMemo(() => {
    if (!session?.user) {
      return {
        hasModule: () => false,
        enabledModules: new Set<BusinessModule>(),
        isRestaurantNative: false
      };
    }

    const user = session.user as any;
    const modules: BusinessModule[] = [];

    if (user.enableTables) modules.push('tables');
    if (user.enableDelivery) modules.push('delivery');
    if (user.enableWaiters) modules.push('waiters');
    if (user.enableSplitBill) modules.push('split_bill');
    if (user.enableTips) modules.push('tips');
    if (user.enableKitchen) modules.push('kitchen');
    if (user.enableKitchenDisplay) modules.push('kitchen_display');
    if (user.enableKitchenTickets) modules.push('kitchen_tickets');
    if (user.enableKitchenPrinting) modules.push('kitchen_printing');
    if (user.enableOrderRounds) modules.push('order_rounds');
    if (user.enableProductModifiers) modules.push('product_modifiers');
    if (user.enableReservations) modules.push('reservations');
    if (user.enableWaiterShifts) modules.push('waiter_shifts');
    if (user.enableQrMenu) modules.push('qr_menu');

    // Legacy fallback mapping para los que usan features relacionadas
    if (user.enableTables) {
      modules.push('table_transfer');
      modules.push('pre_check');
    }

    const enabledModules = new Set(modules);

    return {
      hasModule: (m: BusinessModule) => enabledModules.has(m),
      enabledModules,
      isRestaurantNative: user.businessType ? ['RESTAURANT', 'CAFETERIA', 'BAR', 'NIGHTCLUB'].includes(user.businessType) : false
    };
  }, [session?.user]);

  return (
    <FeatureModuleContext.Provider value={value}>
      {children}
    </FeatureModuleContext.Provider>
  );
}

/** Hook para consumir el contexto de los módulos activos */
export function useModules(): FeatureModuleContextType {
  const context = useContext(FeatureModuleContext);
  if (!context) {
    throw new Error('useModules must be used within a FeatureModuleProvider');
  }
  return context;
}

/** Wrapper condicional para renderizar elementos de UI solo si se tiene el módulo activado */
export function ModuleGuard({ 
  module, 
  children, 
  fallback = null 
}: { 
  module: BusinessModule | BusinessModule[]; 
  children: ReactNode; 
  fallback?: ReactNode; 
}) {
  const { hasModule } = useModules();
  
  const isAllowed = Array.isArray(module) 
    ? module.some(m => hasModule(m)) 
    : hasModule(module);

  if (!isAllowed) return <>{fallback}</>;
  
  return <>{children}</>;
}
