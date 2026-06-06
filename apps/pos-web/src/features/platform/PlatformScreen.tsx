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
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>Dashboard de Plataforma</h1>
          <p style={{ color: 'var(--color-slate-500)', fontSize: '1rem' }}>Resumen global de organizaciones y usuarios del SaaS.</p>
        </div>
      </header>

      {error && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: 'var(--color-error-50)', color: 'var(--color-error-700)', borderRadius: '0.75rem', border: '1px solid var(--color-error-200)', fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* Global Metrics - Bento Grid */}
      {globalMetrics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
          <div style={{ background: '#ffffff', borderRadius: '1.25rem', padding: '1.5rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-10px', right: '-10px', width: '80px', height: '80px', background: 'var(--color-primary-50)', borderRadius: '50%', zIndex: 0 }}></div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '0.5rem', background: 'var(--color-primary-100)', color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                </div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>Tenants Totales</h3>
              </div>
              <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{globalMetrics.totalTenants}</p>
            </div>
          </div>
          
          <div style={{ background: '#ffffff', borderRadius: '1.25rem', padding: '1.5rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-10px', right: '-10px', width: '80px', height: '80px', background: 'var(--color-success-50)', borderRadius: '50%', zIndex: 0 }}></div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '0.5rem', background: 'var(--color-success-100)', color: 'var(--color-success-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>Tenants Activos</h3>
              </div>
              <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{globalMetrics.activeTenants}</p>
            </div>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '1.25rem', padding: '1.5rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: '-10px', right: '-10px', width: '80px', height: '80px', background: 'var(--color-warning-50)', borderRadius: '50%', zIndex: 0 }}></div>
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '0.5rem', background: 'var(--color-warning-100)', color: 'var(--color-warning-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                </div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-slate-600)' }}>Usuarios Totales</h3>
              </div>
              <p style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{globalMetrics.totalUsers}</p>
            </div>
          </div>
        </div>
      )}

      <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--color-slate-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>Directorio de Organizaciones</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '800px' }}>
            <thead style={{ background: 'var(--color-slate-50)' }}>
              <tr>
                <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Negocio</th>
                <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</th>
                <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Plan</th>
                <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Propietario</th>
                <th style={{ padding: '1rem 1.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody style={{}}>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--color-slate-100)', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.backgroundColor = 'var(--color-slate-50)'} onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700 }}>
                        {t.business_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--color-slate-900)', fontSize: '0.9375rem' }}>{t.business_name}</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)', marginTop: '0.125rem' }}>NIT: {t.document_number}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <span style={{ 
                      padding: '0.375rem 0.75rem', 
                      borderRadius: '9999px', 
                      fontSize: '0.75rem', 
                      fontWeight: 600,
                      backgroundColor: t.status === 'ACTIVE' ? 'var(--color-success-100)' : t.status === 'SUSPENDED' ? 'var(--color-error-100)' : 'var(--color-warning-100)',
                      color: t.status === 'ACTIVE' ? 'var(--color-success-700)' : t.status === 'SUSPENDED' ? 'var(--color-error-700)' : 'var(--color-warning-700)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.375rem'
                    }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: t.status === 'ACTIVE' ? 'var(--color-success-500)' : t.status === 'SUSPENDED' ? 'var(--color-error-500)' : 'var(--color-warning-500)' }}></span>
                      {t.status === 'ACTIVE' ? 'Activo' : t.status === 'SUSPENDED' ? 'Suspendido' : t.status}
                    </span>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)', background: 'var(--color-slate-100)', padding: '0.25rem 0.75rem', borderRadius: '0.5rem', display: 'inline-block' }}>
                      {t.plan || 'Free'}
                    </div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-slate-700)' }}>{t.owner_email}</div>
                  </td>
                  <td style={{ padding: '1.25rem 1.5rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      <button 
                        style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--color-slate-200)', borderRadius: '0.5rem', backgroundColor: '#ffffff', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)', transition: 'all 0.2s' }} 
                        onClick={() => showTenantMetrics(t.id)}
                        onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--color-slate-300)'; e.currentTarget.style.background = 'var(--color-slate-50)'; }}
                        onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--color-slate-200)'; e.currentTarget.style.background = '#ffffff'; }}
                      >
                        Métricas
                      </button>
                      <button 
                        style={{ padding: '0.5rem 0.75rem', border: `1px solid ${t.status === 'ACTIVE' ? 'var(--color-error-200)' : 'var(--color-success-200)'}`, borderRadius: '0.5rem', backgroundColor: '#ffffff', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, color: t.status === 'ACTIVE' ? 'var(--color-error-600)' : 'var(--color-success-600)', transition: 'all 0.2s' }} 
                        onClick={() => handleToggleStatus(t.id, t.status)}
                        onMouseOver={e => { e.currentTarget.style.background = t.status === 'ACTIVE' ? 'var(--color-error-50)' : 'var(--color-success-50)'; }}
                        onMouseOut={e => { e.currentTarget.style.background = '#ffffff'; }}
                      >
                        {t.status === 'ACTIVE' ? 'Suspender' : 'Activar'}
                      </button>
                      <button 
                        style={{ padding: '0.5rem 0.75rem', border: 'none', borderRadius: '0.5rem', backgroundColor: 'var(--color-slate-900)', color: 'white', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, transition: 'all 0.2s', boxShadow: 'var(--shadow-sm)' }} 
                        onClick={() => handleImpersonate(t.id, t.owner_user_id)}
                        onMouseOver={e => { e.currentTarget.style.background = 'var(--color-slate-800)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseOut={e => { e.currentTarget.style.background = 'var(--color-slate-900)'; e.currentTarget.style.transform = 'none'; }}
                      >
                        Ingresar &rarr;
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isMetricsModalOpen && (
        <Modal ariaLabel="Métricas de la Organización" onClose={() => setIsMetricsModalOpen(false)}>
          <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' }}>
            <header>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-slate-900)' }}>Rendimiento de la Organización</h2>
              <p style={{ color: 'var(--color-slate-500)', fontSize: '0.9375rem' }}>Métricas clave operativas</p>
            </header>
            
            {!selectedTenantMetrics ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--color-slate-100)', borderTopColor: 'var(--color-primary-600)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div style={{ backgroundColor: 'var(--color-slate-50)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-slate-200)' }}>
                  <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Usuarios</h4>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{selectedTenantMetrics.metrics.usersCount}</p>
                </div>
                <div style={{ backgroundColor: 'var(--color-slate-50)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-slate-200)' }}>
                  <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Sucursales</h4>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{selectedTenantMetrics.metrics.branchesCount}</p>
                </div>
                <div style={{ backgroundColor: 'var(--color-primary-50)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-primary-100)' }}>
                  <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary-700)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Ventas Totales</h4>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-900)', lineHeight: 1 }}>{selectedTenantMetrics.metrics.salesCount}</p>
                </div>
                <div style={{ backgroundColor: 'var(--color-slate-50)', padding: '1.5rem', borderRadius: '1rem', border: '1px solid var(--color-slate-200)' }}>
                  <h4 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Productos</h4>
                  <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-slate-900)', lineHeight: 1 }}>{selectedTenantMetrics.metrics.productsCount}</p>
                </div>
              </div>
            )}
            
            <button 
              onClick={() => setIsMetricsModalOpen(false)}
              style={{ padding: '0.875rem', background: 'var(--color-slate-100)', color: 'var(--color-slate-700)', border: 'none', borderRadius: '0.75rem', fontWeight: 600, cursor: 'pointer', marginTop: '0.5rem' }}
            >
              Cerrar
            </button>
          </div>
        </Modal>
      )}
      
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
