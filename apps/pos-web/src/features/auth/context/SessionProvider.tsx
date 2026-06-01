import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ApiClientError, createApiClient, type AuthSession, type UserRole } from '../../../lib/api';
import { API_BASE_URL } from '../../../lib/env';
import { readAuthUser, writeAuthUser, writePosContext } from '../../../lib/session';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró o ya no es válida. Inicia sesión de nuevo.';

interface SessionContextValue {
  api: ReturnType<typeof createApiClient>;
  authMessage: string | null;
  clearAuthMessage: () => void;
  isHydrating: boolean;
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string; tenantId?: string }) => Promise<void>;
  logout: () => void;
  role: UserRole | null;
  session: AuthSession | null;
  tenantId: string | null;
  token: string | null;
  user: AuthSession['user'] | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialUserRef = useRef<AuthSession['user'] | null>(readAuthUser());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthSession['user'] | null>(initialUserRef.current);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  const sessionRef = useRef<AuthSession | null>(session);

  const commitSession = useCallback((nextSession: AuthSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (nextSession?.user) {
      setUser(nextSession.user);
      writeAuthUser(nextSession.user);
    } else {
      setUser(null);
      writeAuthUser(null);
    }
  }, []);

  const clearSession = useCallback(
    (reason?: string) => {
      sessionRef.current = null;
      setSession(null);
      setUser(null);
      writeAuthUser(null);
      writePosContext(null);
      setAuthMessage(reason ?? null);
    },
    []
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getSession: () => sessionRef.current,
        setSession: (nextSession) => {
          if (nextSession) {
            commitSession(nextSession);
            return;
          }

          clearSession(SESSION_EXPIRED_MESSAGE);
        }
      }),
    [clearSession, commitSession]
  );

  const clearAuthMessage = useCallback(() => {
    setAuthMessage(null);
  }, []);

  const login = useCallback(
    async (credentials: { email: string; password: string; tenantId?: string }) => {
      clearAuthMessage();
      const response = await api.login(credentials.email, credentials.password, credentials.tenantId);

      if (response.requireTenantSelection && response.tenants) {
        // We throw an object or handle it via a special error so LoginScreen can catch it
        throw { requireTenantSelection: true, tenants: response.tenants };
      }

      if (!response.accessToken || !response.user) {
        throw new Error('Credenciales inválidas');
      }

      commitSession({ accessToken: response.accessToken, user: response.user });
    },
    [api, clearAuthMessage, commitSession]
  );

  const logout = useCallback(() => {
    void api.logout().finally(() => {
      clearSession();
    });
  }, [api, clearSession]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const refreshedSession = await api.refresh();
        if (cancelled) {
          return;
        }

        if (refreshedSession) {
          commitSession(refreshedSession);
        } else {
          // If we had a user but refresh failed (and not a network error), clear it
          if (user) {
            clearSession(SESSION_EXPIRED_MESSAGE);
          } else {
            clearSession();
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiClientError && error.isNetworkError) {
          // We are offline. We can't refresh. We must stay unauthenticated
          // or allow limited offline capabilities using the stored user.
          // For now, if we have a user, we stay logged out but keep the user profile?
          if (user) {
            clearSession('Error de conexión. Revisa tu internet e intenta de nuevo.');
          } else {
            clearSession();
          }
          return;
        }

        if (user) {
          clearSession(SESSION_EXPIRED_MESSAGE);
        } else {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [api, clearSession, commitSession]);

  const value = useMemo<SessionContextValue>(
    () => ({
      api,
      authMessage,
      clearAuthMessage,
      isAuthenticated: Boolean(session),
      isHydrating,
      login,
      logout,
      role: user?.role ?? null,
      session,
      tenantId: user?.tenantId ?? null,
      token: session?.accessToken ?? null,
      user: user
    }),
    [api, authMessage, clearAuthMessage, isHydrating, login, logout, session, user]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }

  return context;
}
