import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { platformKeys } from '../../shared/query-keys';
import { ExecutiveMetricsWidget } from './components/ExecutiveMetricsWidget';
import { GrowthChartsWidget } from './components/GrowthChartsWidget';
import { PlatformAlertsWidget } from './components/PlatformAlertsWidget';
import { PlatformHealthWidget } from './components/PlatformHealthWidget';
import { RecentActivityWidget } from './components/RecentActivityWidget';
import { AdvancedTenantsTable } from './components/AdvancedTenantsTable';
import { CreateTenantModal } from './components/CreateTenantModal';
import { TenantDetailDrawer } from './components/TenantDetailDrawer';
import { PlansManagementTab } from './components/PlansManagementTab';
import { RevenueWidget } from './components/RevenueWidget';
import { Banner } from '../../components/ui';


import { PlatformTenantSearchResult } from '../../lib/api/client';
import { PlatformHealthResponse } from './components/PlatformHealthWidget';
import { useApi } from '../auth';

export function PlatformScreen() {
  const api = useApi();
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'REVENUE' | 'TENANTS' | 'PLANS'>('OVERVIEW');

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantSearchResult | null>(null);

  const [searchParams, setSearchParams] = useState({ query: '', status: 'ALL' });

  // Los filtros viajan dentro de la clave: cambiarlos es otra consulta, y la anterior queda
  // en caché para cuando el administrador vuelva a ella.
  const consultaTenants = useQuery({
    queryKey: platformKeys.tenants(searchParams),
    queryFn: () => api.listTenants(searchParams)
  });

  const consultaDashboard = useQuery({
    queryKey: platformKeys.dashboard(),
    queryFn: () => api.getPlatformDashboard()
  });

  const consultaGrowth = useQuery({
    queryKey: platformKeys.growth(),
    queryFn: () => api.getPlatformGrowth()
  });

  const consultaHealth = useQuery({
    queryKey: platformKeys.health(),
    queryFn: () => api.getPlatformHealth()
  });

  const consultaActivity = useQuery({
    queryKey: platformKeys.activity(),
    queryFn: () => api.getPlatformActivity()
  });

  const tenants = consultaTenants.data?.items ?? [];
  const dashboardMetrics = consultaDashboard.data?.metrics ?? null;
  const growthData = consultaGrowth.data?.history ?? [];
  const healthData = (consultaHealth.data as unknown as PlatformHealthResponse | undefined) ?? null;
  const recentActivity = consultaActivity.data?.activity ?? [];

  const loading =
    consultaTenants.isPending ||
    consultaDashboard.isPending ||
    consultaGrowth.isPending ||
    consultaHealth.isPending ||
    consultaActivity.isPending;

  // Las cinco cargas compartían un solo cartel cuando eran un `Promise.all`; se conserva
  // mostrando el primer fallo que haya.
  const fallo = [
    consultaTenants.error,
    consultaDashboard.error,
    consultaGrowth.error,
    consultaHealth.error,
    consultaActivity.error
  ].find(Boolean);
  const error = fallo instanceof Error ? fallo.message : fallo ? String(fallo) : null;

  // Handle impersonate from table fast action
  const suplantacion = useMutation({
    mutationFn: (tenantId: string) => api.impersonateTenant(tenantId, 'Impersonation via Superadmin Dashboard'),
    // No invalida nada: la redirección recarga la aplicación entera, y con ella la caché.
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (err: unknown) => alert(err instanceof Error ? err.message : String(err))
  });

  function handleImpersonate(tenantId: string) {
    suplantacion.mutate(tenantId);
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto font-sans animate-in fade-in duration-300">
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-foreground tracking-tight mb-1">SaaS Control Center</h1>
        <p className="text-muted-foreground text-base">Operación ejecutiva y gestión de organizaciones.</p>
        
        <div className="flex gap-4 mt-6 border-b border-border overflow-x-auto pb-px">
          {['OVERVIEW', 'REVENUE', 'TENANTS', 'PLANS'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as 'OVERVIEW' | 'REVENUE' | 'TENANTS' | 'PLANS')}
              className={`pb-3 px-1 text-sm font-semibold transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
              }`}
            >
              {tab === 'OVERVIEW' ? 'Resumen Ejecutivo' : tab === 'REVENUE' ? 'Ingresos' : tab === 'TENANTS' ? 'Directorio de Tenants' : 'Planes de Suscripción'}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="mb-8">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {loading && !dashboardMetrics ? (
        <div className="grid gap-6">
           <div className="h-32 bg-muted/50 rounded-2xl animate-pulse" />
           <div className="h-72 bg-muted/50 rounded-2xl animate-pulse" />
        </div>
      ) : (
        <div className="animate-in slide-in-from-bottom-4 duration-500">
          {activeTab === 'OVERVIEW' && (
            <div className="flex flex-col gap-8">
              <ExecutiveMetricsWidget metrics={dashboardMetrics} />
              <GrowthChartsWidget growthData={growthData} />
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PlatformAlertsWidget baseUrl={api.baseUrl} sessionToken={api.getAccessToken() || ''} />
                <RecentActivityWidget activity={recentActivity} />
              </div>

              <PlatformHealthWidget health={healthData} />
            </div>
          )}

          {activeTab === 'REVENUE' && <RevenueWidget />}

          {activeTab === 'TENANTS' && (
            <AdvancedTenantsTable 
              tenants={tenants} 
              onSearch={(query: string) => setSearchParams(prev => ({ ...prev, query }))}
              onFilterStatus={(status: string) => setSearchParams(prev => ({ ...prev, status }))}
              onImpersonate={handleImpersonate}
              onCreate={() => setIsCreateModalOpen(true)}
              onEdit={(tenant: PlatformTenantSearchResult) => setSelectedTenant(tenant)}
            />
          )}

          {activeTab === 'PLANS' && (
            <PlansManagementTab />
          )}

          {isCreateModalOpen && (
            <CreateTenantModal 
              onClose={() => setIsCreateModalOpen(false)}
              onSuccess={() => { setIsCreateModalOpen(false); }}
            />
          )}

          {/* El drawer invalida por su cuenta las claves que escribe; aquí solo se deja
              abierto a propósito, para que el administrador vea el cambio aplicado. */}
          <TenantDetailDrawer
            tenant={selectedTenant}
            isOpen={!!selectedTenant}
            onClose={() => setSelectedTenant(null)}
            onSuccess={() => {}}
          />
        </div>
      )}
    </div>
  );
}
