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

interface PlatformScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
}

export function PlatformScreen({ api }: PlatformScreenProps) {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'TENANTS' | 'PLANS'>('OVERVIEW');
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardMetrics, setDashboardMetrics] = useState<any>(null);
  const [growthData, setGrowthData] = useState<any[]>([]);
  const [healthData, setHealthData] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useState({ query: '', status: 'ALL' });

  useEffect(() => {
    loadData();
  }, [searchParams]);

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
      setHealthData(healthDataReq);
      setRecentActivity(activityDataReq.activity || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Handle impersonate from table fast action
  async function handleImpersonate(tenantId: string) {
    try {
      await api.impersonateTenant(tenantId, 'Impersonation via Superadmin Dashboard');
      window.location.href = '/';
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>SaaS Control Center</h1>
        <p style={{ color: 'var(--color-slate-500)', fontSize: '1rem' }}>Operación ejecutiva y gestión de organizaciones.</p>
        
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', borderBottom: '1px solid var(--color-slate-200)' }}>
          {['OVERVIEW', 'TENANTS', 'PLANS'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              style={{
                padding: '0.75rem 1rem', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 600, 
                color: activeTab === tab ? 'var(--color-primary-600)' : 'var(--color-slate-500)',
                borderBottom: activeTab === tab ? '2px solid var(--color-primary-600)' : '2px solid transparent'
              }}
            >
              {tab === 'OVERVIEW' ? 'Resumen Ejecutivo' : tab === 'TENANTS' ? 'Directorio de Tenants' : 'Planes de Suscripción'}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--color-error-50)', color: 'var(--color-error-700)', borderRadius: '0.75rem', border: '1px solid var(--color-error-200)', fontWeight: 500 }}>
          {error}
        </div>
      )}

      {loading && !dashboardMetrics ? (
        <div style={{ display: 'grid', gap: '1.5rem' }}>
           <div style={{ height: '120px', background: 'var(--color-slate-100)', borderRadius: '1.25rem', animation: 'pulse 1.5s infinite' }} />
           <div style={{ height: '300px', background: 'var(--color-slate-100)', borderRadius: '1.25rem', animation: 'pulse 1.5s infinite' }} />
        </div>
      ) : (
        <>
          {activeTab === 'OVERVIEW' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <ExecutiveMetricsWidget metrics={dashboardMetrics} />
              <GrowthChartsWidget growthData={growthData} />
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
                <PlatformAlertsWidget baseUrl={api.baseUrl} sessionToken={api.getAccessToken() || ''} />
                <RecentActivityWidget activity={recentActivity} />
              </div>

              <PlatformHealthWidget health={healthData} />
            </div>
          )}

          {activeTab === 'TENANTS' && (
            <AdvancedTenantsTable 
              tenants={tenants} 
              onSearch={(query: string) => setSearchParams(prev => ({ ...prev, query }))}
              onFilterStatus={(status: string) => setSearchParams(prev => ({ ...prev, status }))}
              onImpersonate={handleImpersonate}
              onCreate={() => setIsCreateModalOpen(true)}
              onEdit={(tenant: any) => setSelectedTenant(tenant)}
              onChangePlan={(tenant: any) => setSelectedTenant(tenant)} // Plan is now inside drawer
              onSuspend={(tenant: any) => setSelectedTenant(tenant)} // Actions are inside drawer
              onReactivate={(tenant: any) => setSelectedTenant(tenant)} 
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
        </>
      )}
    </div>
  );
}
