import { useState } from 'react';
import { Banner } from '../../components/ui';
import { LoginForm } from './components/LoginForm';
import { useSession } from './context/SessionProvider';

export function LoginScreen() {
  const { authMessage, clearAuthMessage, login } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<{ id: string; name: string; business_name: string }[] | null>(null);
  const [pendingCredentials, setPendingCredentials] = useState<{ email: string; password: string } | null>(null);

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

  return (
    <>
      <main className="auth-layout" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-slate-50)', padding: '1rem' }}>
        <section className="auth-card" style={{ width: '100%', maxWidth: '400px', background: '#ffffff', padding: '2.5rem', borderRadius: 'var(--radius-2xl)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', border: '1px solid var(--color-slate-100)' }}>
          <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <div style={{ width: '48px', height: '48px', background: 'var(--color-primary-600)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#ffffff', fontSize: '1.5rem', fontWeight: 700 }}>
              P
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem' }}>BIENVENIDO</h1>
            <p className="subtle-text" style={{ fontSize: '0.875rem' }}>Ingresa tus credenciales para acceder al punto de venta</p>
          </header>

          <div className="stack-md">
            {authMessage && (
              <div style={{ marginBottom: '1.5rem' }}>
                <Banner tone="info">{authMessage}</Banner>
              </div>
            )}
            {error && (
              <div style={{ marginBottom: '1.5rem' }}>
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            <LoginForm
              loading={loading && !tenantOptions}
              onChange={() => {
                clearAuthMessage();
                setError(null);
              }}
              onSubmit={handleSubmit}
            />

            <footer style={{ marginTop: '2rem', textAlign: 'center', paddingTop: '1.5rem', borderTop: '1px solid var(--color-slate-100)' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-400)' }}>
                &copy; {new Date().getFullYear()} POS Cloud. Sistema de Facturación Electrónica.
              </p>
            </footer>
          </div>
        </section>
      </main>

      {tenantOptions && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '400px' }}>
            <header className="section-heading" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2>Selecciona una Empresa</h2>
                <p>Tu usuario tiene acceso a múltiples empresas.</p>
              </div>
            </header>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {tenantOptions.map(tenant => (
                <button
                  key={tenant.id}
                  onClick={() => handleSelectTenant(tenant.id)}
                  disabled={loading}
                  style={{
                    padding: '1rem',
                    textAlign: 'left',
                    background: 'var(--color-slate-50)',
                    border: '1px solid var(--color-slate-200)',
                    borderRadius: 'var(--radius-lg)',
                    cursor: loading ? 'wait' : 'pointer'
                  }}
                >
                  <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--color-slate-900)' }}>{tenant.name}</strong>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)' }}>{tenant.business_name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => { setTenantOptions(null); setPendingCredentials(null); }}
              className="button button-outline"
              style={{ width: '100%', marginTop: '1.5rem' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
