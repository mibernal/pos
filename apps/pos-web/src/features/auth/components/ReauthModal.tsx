import { useState } from 'react';
import { useSession } from '../context/SessionProvider';
import { LoginForm } from './LoginForm';

export function ReauthModal() {
  const { authState, rejectReauth, resolveReauth, api } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (authState !== 'reauth_required') {
    return null;
  }

  const handleLogin = async (credentials: { email: string; password: string }) => {
    try {
      setLoading(true);
      setError(null);
      // Re-login does not necessarily need a tenantId if it's already set or just renewing
      const response = await api.login(credentials.email, credentials.password);
      if (!response.accessToken || !response.user) {
        throw new Error('Credenciales inválidas');
      }
      resolveReauth({ accessToken: response.accessToken, user: response.user });
    } catch (err: any) {
      setError(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(8px)', padding: '1.5rem', fontFamily: 'var(--font-sans)', animation: 'fadeIn 0.2s ease-out' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: '#ffffff', borderRadius: '1.5rem', padding: '2.5rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255,255,255,0.1)', animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ width: '56px', height: '56px', background: 'var(--color-warning-50)', color: 'var(--color-warning-600)', borderRadius: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>Sesión Expirada</h2>
          <p style={{ fontSize: '0.9375rem', color: 'var(--color-slate-500)' }}>
            Por tu seguridad hemos pausado la sesión. Ingresa tu contraseña para continuar exactamente donde estabas.
          </p>
        </div>

        {error && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--color-error-50)', color: 'var(--color-error-700)', borderRadius: '0.75rem', border: '1px solid var(--color-error-100)', fontSize: '0.875rem', fontWeight: 500 }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <LoginForm 
            onSubmit={handleLogin}
            loading={loading}
          />
        </div>

        <div style={{ textAlign: 'center' }}>
          <button
            onClick={rejectReauth}
            disabled={loading}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-slate-500)', fontSize: '0.875rem', fontWeight: 600, cursor: loading ? 'wait' : 'pointer', transition: 'color 0.2s' }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--color-error-600)' }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--color-slate-500)' }}
          >
            Cancelar y volver al inicio de sesión
          </button>
        </div>
      </div>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
