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
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Sesión Expirada</h2>
          <p className="mt-2 text-sm text-gray-600">
            Tu sesión por motivos de seguridad ha caducado. Ingresa tu contraseña para continuar exactamente donde estabas.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
          <LoginForm 
            onSubmit={handleLogin}
            loading={loading}
          />
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={rejectReauth}
            disabled={loading}
            className="text-sm font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
          >
            Cancelar y salir al Login principal
          </button>
        </div>
      </div>
    </div>
  );
}
