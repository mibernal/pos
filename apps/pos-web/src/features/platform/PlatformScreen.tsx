import { useState, useEffect } from 'react';
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

interface PlatformScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
}

import {
  PlatformDashboardMetrics,
  PlatformGrowthMetric,
  PlatformActivityEvent,
  PlatformTenantSearchResult
} from '../../lib/api/client';
import { PlatformHealthResponse } from './components/PlatformHealthWidget';

export function PlatformScreen({ api }: PlatformScreenProps) {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'REVENUE' | 'TENANTS' | 'PLANS'>('OVERVIEW');
  const [tenants, setTenants] = useState<PlatformTenantSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardMetrics, setDashboardMetrics] = useState<PlatformDashboardMetrics | null>(null);
  const [growthData, setGrowthData] = useState<PlatformGrowthMetric[]>([]);
  const [healthData, setHealthData] = useState<PlatformHealthResponse | null>(null);
  const [recentActivity, setRecentActivity] = useState<PlatformActivityEvent[]>([]);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<PlatformTenantSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useState({ query: '', status: 'ALL' });

  useEffect(() => {
    loadData();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    try {
      setLoading(true);
      const [tenantsData, metricsData, growthDataReq, healthDataReq, activityDataReq] = await Promise.all([
        api.listTenants(searchParams),
        api.getPlatformDashboard(),
        api.getPlatformGrowth(),
        api.getPlatformHealth(),
        api.getPlatformActivity()
      ]);
      setTenants(tenantsData.items || []);
      setDashboardMetrics(metricsData.metrics);
      setGrowthData(growthDataReq.history || []);
      setHealthData(healthDataReq as unknown as PlatformHealthResponse);
      setRecentActivity(activityDataReq.activity || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Handle impersonate from table fast action
  async function handleImpersonate(tenantId: string) {
    try {
      await api.impersonateTenant(tenantId, 'Impersonation via Superadmin Dashboard');
      window.location.href = '/';
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err));
    }
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

          {activeTab === 'REVENUE' && <RevenueWidget api={api} />}

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
            <PlansManagementTab api={api} />
          )}

          {isCreateModalOpen && (
            <CreateTenantModal 
              api={api}
              onClose={() => setIsCreateModalOpen(false)}
              onSuccess={() => { setIsCreateModalOpen(false); loadData(); }}
            />
          )}

          <TenantDetailDrawer
            api={api}
            tenant={selectedTenant}
            isOpen={!!selectedTenant}
            onClose={() => setSelectedTenant(null)}
            onSuccess={() => { loadData(); }} // Don't close so they can see changes
          />
        </div>
      )}
    </div>
  );
}
