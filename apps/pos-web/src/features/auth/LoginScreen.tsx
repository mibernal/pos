import { useState } from 'react';
import { Banner } from '../../components/ui';
import { LoginForm } from './components/LoginForm';
import { useSession } from './context/SessionProvider';

export function LoginScreen() {
  const { authMessage, clearAuthMessage, login } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(input: { email: string; password: string }) {
    setLoading(true);
    setError(null);
    clearAuthMessage();

    try {
      await login(input);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'No fue posible iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card">
        <h1>POS DIAN</h1>
        <p className="subtle-text">Ingresa con tu usuario para abrir caja y operar ventas</p>
        <div className="stack-md">
          {authMessage ? <Banner tone="warning">{authMessage}</Banner> : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <LoginForm
            loading={loading}
            onChange={() => {
              clearAuthMessage();
              setError(null);
            }}
            onSubmit={handleSubmit}
          />
        </div>
      </section>
    </main>
  );
}
