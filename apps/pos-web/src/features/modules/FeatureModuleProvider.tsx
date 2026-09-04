import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { modulesFromFlags, type BusinessModule } from '@pos-dian/shared';
import { useSession } from '../auth';

export type FeatureModuleContextType = {
  hasModule: (module: BusinessModule) => boolean;
  enabledModules: Set<BusinessModule>;
};

const FeatureModuleContext = createContext<FeatureModuleContextType | null>(null);

export function FeatureModuleProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();

  const value = useMemo(() => {
    /**
     * Los módulos vienen resueltos del servidor.
     *
     * Aquí había veintiuna líneas de `if (user.enableX) modules.push('x')` sobre un
     * `as any`: una tercera copia de una lista que el API ya escribía dos veces. Al
     * divergir —y divergían, porque había que acordarse de tocar las tres— el comercio veía
     * menús que no podía usar, o dejaba de ver los que sí. `modulesFromFlags` deriva de la
     * misma lista que usa el API, así que ya no pueden separarse.
     *
     * `modules` llega directo desde la fase 11; `modulesFromFlags` cubre el rato en que un
     * token viejo, emitido antes del despliegue, todavía circula sin ese campo.
     */
    const usuario = session?.user as (Record<string, unknown> & { modules?: BusinessModule[] }) | undefined;

    if (!usuario) {
      return {
        hasModule: () => false,
        enabledModules: new Set<BusinessModule>()
      };
    }

    const enabledModules = new Set<BusinessModule>(
      usuario.modules ?? (modulesFromFlags(usuario) as BusinessModule[])
    );

    /**
     * `table_transfer` y `pre_check` no son módulos asignables: son capacidades que van con
     * las mesas. Se mantienen porque hay pantallas que preguntan por ellas.
     */
    if (enabledModules.has('tables')) {
      enabledModules.add('table_transfer');
      enabledModules.add('pre_check');
    }

    return {
      hasModule: (m: BusinessModule) => enabledModules.has(m),
      enabledModules
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
