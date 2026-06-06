import { useState, useEffect } from 'react';
import { Modal } from '../../components/ui';

interface PlatformScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
}

export function PlatformScreen({ api }: PlatformScreenProps) {
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalMetrics, setGlobalMetrics] = useState<any>(null);
  const [selectedTenantMetrics, setSelectedTenantMetrics] = useState<any>(null);
  const [isMetricsModalOpen, setIsMetricsModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [tenantsData, metricsData] = await Promise.all([
        api.listTenants(),
        api.getGlobalMetrics()
      ]);
      setTenants(tenantsData.tenants || []);
      setGlobalMetrics(metricsData.globalMetrics);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStatus(tenantId: string, currentStatus: string) {
    try {
      const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
      await api.updateTenantStatus(tenantId, newStatus);
      await loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function handleImpersonate(tenantId: string, ownerId: string) {
    try {
      await api.impersonateTenant(tenantId, ownerId);
      // Reload session by setting the token and calling me
      localStorage.setItem('pos_impersonation', 'true');
      window.location.reload(); // Hard reload is safest for impersonation to clear React state
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function showTenantMetrics(tenantId: string) {
    try {
      setSelectedTenantMetrics(null);
      setIsMetricsModalOpen(true);
      const data = await api.getTenantMetrics(tenantId);
      setSelectedTenantMetrics(data);
    } catch (err: any) {
      alert(err.message);
      setIsMetricsModalOpen(false);
    }
  }

  if (loading && !tenants.length) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '16rem' }}>
        <div>Cargando...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Panel de Plataforma SaaS</h1>
      </div>

      {error && <div style={{ color: 'red', backgroundColor: '#fee2e2', padding: '1rem', borderRadius: '0.375rem' }}>{error}</div>}

      {globalMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ backgroundColor: 'white', padding: '1rem', borderRadius: '0.375rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Tenants Totales</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{globalMetrics.totalTenants}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '1rem', borderRadius: '0.375rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Usuarios Totales</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{globalMetrics.totalUsers}</p>
          </div>
          <div style={{ backgroundColor: 'white', padding: '1rem', borderRadius: '0.375rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Tenants Activos</h3>
            <p style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{globalMetrics.activeTenants}</p>
          </div>
        </div>
      )}

      <div style={{ backgroundColor: 'white', borderRadius: '0.375rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <div style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 500, marginBottom: '1rem' }}>Gestión de Tenants</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Negocio</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>NIT</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Estado</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Plan</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Propietario</th>
                  <th style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500, color: '#6b7280', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                      <div style={{ fontWeight: 500 }}>{t.business_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{t.name}</div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#4b5563' }}>{t.document_number}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '9999px', 
                        fontSize: '0.75rem', 
                        fontWeight: 500,
                        backgroundColor: t.status === 'ACTIVE' ? '#d1fae5' : t.status === 'SUSPENDED' ? '#fee2e2' : '#fef3c7',
                        color: t.status === 'ACTIVE' ? '#065f46' : t.status === 'SUSPENDED' ? '#991b1b' : '#92400e'
                      }}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#4b5563' }}>{t.plan}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#4b5563' }}>{t.owner_email}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', backgroundColor: 'transparent', cursor: 'pointer' }} onClick={() => showTenantMetrics(t.id)}>
                          Métricas
                        </button>
                        <button style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.25rem', backgroundColor: 'transparent', cursor: 'pointer' }} onClick={() => handleToggleStatus(t.id, t.status)}>
                          {t.status === 'ACTIVE' ? 'Suspender' : 'Activar'}
                        </button>
                        <button style={{ padding: '0.25rem 0.5rem', border: 'none', borderRadius: '0.25rem', backgroundColor: '#3b82f6', color: 'white', cursor: 'pointer' }} onClick={() => handleImpersonate(t.id, t.owner_user_id)}>
                          Ingresar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isMetricsModalOpen && (
        <Modal ariaLabel="Métricas del Tenant" onClose={() => setIsMetricsModalOpen(false)}>
          <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>Métricas del Tenant</h2>
            {!selectedTenantMetrics ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>Cargando...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ backgroundColor: '#f9fafb', padding: '1rem', borderRadius: '0.375rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Usuarios</h4>
                  <p style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{selectedTenantMetrics.metrics.usersCount}</p>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '1rem', borderRadius: '0.375rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Sucursales</h4>
                  <p style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{selectedTenantMetrics.metrics.branchesCount}</p>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '1rem', borderRadius: '0.375rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Ventas Registradas</h4>
                  <p style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{selectedTenantMetrics.metrics.salesCount}</p>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '1rem', borderRadius: '0.375rem' }}>
                  <h4 style={{ fontSize: '0.875rem', fontWeight: 500, color: '#6b7280' }}>Productos</h4>
                  <p style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>{selectedTenantMetrics.metrics.productsCount}</p>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
