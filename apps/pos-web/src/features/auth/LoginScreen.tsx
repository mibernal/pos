import { useState } from 'react';
import { Banner } from '../../components/ui';
import { LoginForm } from './components/LoginForm';
import { useSession } from './context/SessionProvider';
import { RegisterScreen } from './RegisterScreen';

// Mock SVG icons
const ChartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"></line>
    <line x1="12" y1="20" x2="12" y2="4"></line>
    <line x1="6" y1="20" x2="6" y2="14"></line>
  </svg>
);

const InvoiceIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

export function LoginScreen() {
  const { authMessage, clearAuthMessage, login, logout, api } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<{ id: string; name: string; business_name: string }[] | null>(null);
  const [pendingCredentials, setPendingCredentials] = useState<{ email: string; password: string } | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  async function handleSubmit(input: { email: string; password: string }, tenantId?: string) {
    setLoading(true);
    setError(null);
    clearAuthMessage();

    try {
      await login({ ...input, tenantId });
      setTenantOptions(null);
      setPendingCredentials(null);
    } catch (err: unknown) {
      const authErr = err as { requireTenantSelection?: boolean; tenants?: { id: string; name: string; business_name: string }[] } | null;
      if (authErr && authErr.requireTenantSelection && authErr.tenants) {
        setTenantOptions(authErr.tenants);
        setPendingCredentials(input);
      } else {
        setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectTenant(tenantId: string) {
    if (pendingCredentials) {
      void handleSubmit(pendingCredentials, tenantId);
    }
  }

  if (isRegistering) {
    return (
      <RegisterScreen 
        api={api}
        login={login}
        onBack={() => setIsRegistering(false)} 
      />
    );
  }

  return (
    <>
      <main style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', background: 'var(--color-slate-50)', fontFamily: 'var(--font-sans)' }}>
        
        {/* Left Column: Hero Section (Visible on all sizes, but stacked on mobile) */}
        <section style={{ 
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #0f172a 0%, #312e81 100%)', // Hardcoded dark colors to ensure contrast
          position: 'relative',
          overflow: 'hidden',
          padding: '4rem 2rem',
          color: '#ffffff',
          minHeight: '40vh'
        }}>
          
          {/* Subtle mesh gradient background effect */}
          <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '400px', height: '400px', background: '#6366f1', filter: 'blur(100px)', opacity: '0.3', borderRadius: '50%' }}></div>
          <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '300px', height: '300px', background: '#3b82f6', filter: 'blur(80px)', opacity: '0.2', borderRadius: '50%' }}></div>

          <div style={{ zIndex: 10, maxWidth: '500px', width: '100%' }}>
            <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.1, marginBottom: '1.5rem', letterSpacing: '-0.03em' }}>
              Gestiona ventas, inventario y facturación desde una sola plataforma.
            </h1>
            <p style={{ fontSize: '1.125rem', color: 'rgba(255, 255, 255, 0.8)', marginBottom: '3rem', fontWeight: 400 }}>
              Más de 5,000 negocios digitalizan sus operaciones con POS Cloud. Rápido, seguro y siempre disponible.
            </p>

            {/* Floating Glass Cards Grid - Hidden on very small screens to save space */}
            <div className="hero-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ 
                background: 'rgba(255, 255, 255, 0.05)', 
                backdropFilter: 'blur(10px)', 
                border: '1px solid rgba(255, 255, 255, 0.1)', 
                padding: '1.5rem', 
                borderRadius: '1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ color: '#60a5fa' }}><ChartIcon /></div>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Ventas Hoy</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>$2.4M</div>
                <div style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 500 }}>+14.5% vs ayer</div>
              </div>

              <div style={{ 
                background: 'rgba(255, 255, 255, 0.05)', 
                backdropFilter: 'blur(10px)', 
                border: '1px solid rgba(255, 255, 255, 0.1)', 
                padding: '1.5rem', 
                borderRadius: '1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ color: '#a78bfa' }}><InvoiceIcon /></div>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>Facturas DIAN</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>142</div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>Procesadas con éxito</div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Auth Form */}
        <section style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          padding: '2rem 1.5rem',
          background: '#ffffff'
        }}>
          <div style={{ width: '100%', maxWidth: '400px' }}>
            <header style={{ marginBottom: '2.5rem' }}>
              <div style={{ width: '40px', height: '40px', background: 'var(--color-primary-600)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.5rem', boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)' }}>
                P
              </div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>Inicia sesión</h1>
              <p style={{ fontSize: '0.9375rem', color: 'var(--color-slate-500)' }}>Ingresa tus credenciales para acceder a tu panel.</p>
            </header>

            {authMessage && (
              <div style={{ marginBottom: '1.5rem' }}>
                <Banner tone="success" onClose={clearAuthMessage}>{authMessage}</Banner>
              </div>
            )}
            
            {error && (
              <div style={{ marginBottom: '1.5rem' }}>
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            <LoginForm onSubmit={(creds) => handleSubmit(creds)} loading={loading} />

            <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>
              ¿No tienes una cuenta? <button onClick={() => setIsRegistering(true)} style={{ background: 'none', border: 'none', color: 'var(--color-primary-600)', fontWeight: 600, cursor: 'pointer', padding: 0 }}>Regístrate aquí</button>
            </div>
          </div>
        </section>
      </main>

      {/* Modern Tenant Selection Modal */}
      {tenantOptions && (
        <div className="modal-overlay" style={{ background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(12px)' }}>
          <div className="modal-card" style={{ maxWidth: '440px', padding: '2.5rem', borderRadius: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <header style={{ marginBottom: '2rem', textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', background: 'var(--color-slate-100)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '1.25rem' }}>
                🏢
              </div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>Selecciona una Empresa</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', marginTop: '0.5rem' }}>Tienes acceso a múltiples organizaciones.</p>
            </header>
            
            <div style={{ display: 'grid', gap: '0.75rem', maxHeight: '300px', overflowY: 'auto' }}>
              {tenantOptions.map((tenant, idx) => (
                <button
                  key={tenant.id || `tenant-${idx}`}
                  onClick={() => handleSelectTenant(tenant.id)}
                  disabled={loading}
                  style={{
                    padding: '1.25rem',
                    textAlign: 'left',
                    background: '#ffffff',
                    border: '1px solid var(--color-slate-200)',
                    borderRadius: '1rem',
                    cursor: loading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    boxShadow: 'var(--shadow-sm)',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary-300)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--color-slate-200)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div>
                    <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--color-slate-900)', fontWeight: 600 }}>{tenant.name}</strong>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)' }}>{tenant.business_name}</span>
                  </div>
                  <div style={{ color: 'var(--color-primary-600)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </button>
              ))}
            </div>
            
            {/* Action Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem', marginTop: '2rem' }}>
              <button
                onClick={() => { setTenantOptions(null); setPendingCredentials(null); }}
                className="ghost-button"
                style={{ width: '100%', padding: '0.875rem', borderRadius: '1rem' }}
              >
                Volver
              </button>
              <button
                onClick={() => {
                  setTenantOptions(null);
                  setPendingCredentials(null);
                  logout(); // Explicitly clear any session states
                }}
                style={{ width: '100%', padding: '0.875rem', borderRadius: '1rem', background: 'transparent', color: 'var(--color-error-600)', border: 'none', fontWeight: 600, cursor: 'pointer' }}
              >
                Cerrar Sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS for responsiveness */}
      <style>{`
        @media (max-width: 768px) {
          .hero-cards { display: none !important; }
        }
      `}</style>
    </>
  );
}
