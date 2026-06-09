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
import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError, createApiClient, type AuthSession, type UserRole } from '../../../lib/api';
import { API_BASE_URL } from '../../../lib/env';
import { readAuthUser, writeAuthUser } from '../../../lib/session';
import { usePosStore } from '../../../hooks/usePosStore';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró o ya no es válida. Inicia sesión de nuevo.';

export type AuthState = 'authenticated' | 'refreshing' | 'reauth_required' | 'unauthenticated';

interface SessionContextValue {
  api: ReturnType<typeof createApiClient>;
  authMessage: string | null;
  clearAuthMessage: () => void;
  authState: AuthState;
  isHydrating: boolean; // keep for backward compatibility
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string; tenantId?: string }) => Promise<void>;
  logout: () => void;
  role: UserRole | null;
  session: AuthSession | null;
  tenantId: string | null;
  token: string | null;
  user: AuthSession['user'] | null;
  resolveReauth: (session: AuthSession) => void;
  rejectReauth: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const getAuthFingerprint = (user?: AuthSession['user'] | null) => {
  if (!user) return null;
  return `${user.id}:${user.tenantId}:${user.role}:${(user.permissions || []).join(',')}:${(user.branchIds || []).join(',')}`;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialUserRef = useRef<AuthSession['user'] | null>(readAuthUser());
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthSession['user'] | null>(initialUserRef.current);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>('refreshing');

  const queryClient = useQueryClient();

  const sessionRef = useRef<AuthSession | null>(session);
  const pendingReauthRef = useRef<Promise<AuthSession | null> | null>(null);
  const reauthResolverRef = useRef<((session: AuthSession | null) => void) | null>(null);

  const commitSession = useCallback((nextSession: AuthSession | null) => {
    const currentFingerprint = getAuthFingerprint(sessionRef.current?.user);
    const nextFingerprint = getAuthFingerprint(nextSession?.user);

    if (currentFingerprint !== nextFingerprint) {
      usePosStore.getState().commitPosContext(null);
      queryClient.clear();
    }
    sessionRef.current = nextSession;
    setSession(nextSession);
    if (nextSession?.user) {
      setUser(nextSession.user);
      writeAuthUser(nextSession.user);
    } else {
      setUser(null);
      writeAuthUser(null);
    }
  }, [queryClient]);

  const clearSession = useCallback(
    (reason?: string, skipReload: boolean = false) => {
      queryClient.clear();
      sessionRef.current = null;
      setSession(null);
      setUser(null);
      writeAuthUser(null);
      usePosStore.getState().commitPosContext(null);
      setAuthMessage(reason ?? null);
      setAuthState('unauthenticated');
      // Clear react query cache and memory by reloading the application
      if (typeof window !== 'undefined' && !skipReload) {
        window.location.reload();
      }
    },
    [queryClient]
  );

  const onReauthRequired = useCallback(() => {
    if (pendingReauthRef.current) {
      return pendingReauthRef.current;
    }

    setAuthState('reauth_required');

    pendingReauthRef.current = new Promise<AuthSession | null>((resolve) => {
      reauthResolverRef.current = resolve;
    });

    return pendingReauthRef.current;
  }, []);

  const resolveReauth = useCallback(
    (newSession: AuthSession) => {
      commitSession(newSession);
      setAuthState('authenticated');
      if (reauthResolverRef.current) {
        reauthResolverRef.current(newSession);
        reauthResolverRef.current = null;
        pendingReauthRef.current = null;
      }
    },
    [commitSession]
  );

  const rejectReauth = useCallback(() => {
    clearSession('Reautenticación cancelada');
    if (reauthResolverRef.current) {
      reauthResolverRef.current(null);
      reauthResolverRef.current = null;
      pendingReauthRef.current = null;
    }
  }, [clearSession]);

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
            setAuthState('authenticated');
            return;
          }
          clearSession(SESSION_EXPIRED_MESSAGE);
        },
        onReauthRequired,
        onQuotaExceeded: (message) => {
          usePosStore.getState().openUpgradeModal(message);
        }
      }),
    [clearSession, commitSession, onReauthRequired]
  );

  const clearAuthMessage = useCallback(() => {
    setAuthMessage(null);
  }, []);

  const login = useCallback(
    async (credentials: { email: string; password: string; tenantId?: string }) => {
      clearAuthMessage();
      const response = await api.login(credentials.email, credentials.password, credentials.tenantId);

      if (response.requireTenantSelection && response.tenants) {
        throw { requireTenantSelection: true, tenants: response.tenants };
      }

      if (!response.accessToken || !response.user) {
        throw new Error('Credenciales inválidas');
      }

      commitSession({ accessToken: response.accessToken, user: response.user });
      setAuthState('authenticated');
    },
    [api, clearAuthMessage, commitSession]
  );

  const logout = useCallback(() => {
    void api.logout().finally(() => {
      clearSession();
    });
  }, [api, clearSession]);

  const refreshPromiseRef = useRef<Promise<AuthSession | null> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        if (!refreshPromiseRef.current) {
          refreshPromiseRef.current = api.refresh();
        }
        const refreshedSession = await refreshPromiseRef.current;
        
        if (cancelled) {
          return;
        }

        if (refreshedSession) {
          commitSession(refreshedSession);
          setAuthState('authenticated');
        } else {
          if (user) {
            clearSession(SESSION_EXPIRED_MESSAGE, true);
          } else {
            clearSession(undefined, true);
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiClientError && error.isNetworkError) {
          if (user) {
            clearSession('Error de conexión. Revisa tu internet e intenta de nuevo.', true);
          } else {
            clearSession(undefined, true);
          }
          return;
        }

        if (user) {
          clearSession(SESSION_EXPIRED_MESSAGE, true);
        } else {
          clearSession(undefined, true);
        }
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, clearSession, commitSession]); // Note: running this once initially. We only re-run if api or clearSession change.

  const value = useMemo<SessionContextValue>(
    () => ({
      api,
      authMessage,
      clearAuthMessage,
      authState,
      isHydrating: authState === 'refreshing',
      isAuthenticated: authState === 'authenticated' || authState === 'reauth_required', // Treat as authenticated to keep DOM
      login,
      logout,
      role: user?.role ?? null,
      session,
      tenantId: user?.tenantId ?? null,
      token: session?.accessToken ?? null,
      user: user,
      resolveReauth,
      rejectReauth
    }),
    [api, authMessage, clearAuthMessage, authState, login, logout, session, user, resolveReauth, rejectReauth]
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
