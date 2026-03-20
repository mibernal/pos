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
import { readAuthSession, writeAuthSession, writePosContext } from '../../../lib/session';

const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró o ya no es válida. Inicia sesión de nuevo.';

interface SessionContextValue {
  api: ReturnType<typeof createApiClient>;
  authMessage: string | null;
  clearAuthMessage: () => void;
  isHydrating: boolean;
  isAuthenticated: boolean;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  role: UserRole | null;
  session: AuthSession | null;
  tenantId: string | null;
  token: string | null;
  user: AuthSession['user'] | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const initialSessionRef = useRef<AuthSession | null>(readAuthSession());
  const [session, setSession] = useState<AuthSession | null>(initialSessionRef.current);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(() => Boolean(initialSessionRef.current));

  const sessionRef = useRef<AuthSession | null>(session);

  const commitSession = useCallback((nextSession: AuthSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    writeAuthSession(nextSession);
  }, []);

  const clearSession = useCallback(
    (reason?: string) => {
      sessionRef.current = null;
      setSession(null);
      writeAuthSession(null);
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
    async (credentials: { email: string; password: string }) => {
      clearAuthMessage();
      const nextSession = await api.login(credentials.email, credentials.password);
      commitSession(nextSession);
    },
    [api, clearAuthMessage, commitSession]
  );

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      if (!sessionRef.current) {
        setIsHydrating(false);
        return;
      }

      try {
        const me = await api.me();
        if (cancelled) {
          return;
        }

        const currentSession = sessionRef.current;
        if (!currentSession) {
          return;
        }

        commitSession({
          ...currentSession,
          user: me.user
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiClientError && error.isNetworkError) {
          setAuthMessage(null);
          return;
        }

        if (sessionRef.current) {
          clearSession(SESSION_EXPIRED_MESSAGE);
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
      role: session?.user.role ?? null,
      session,
      tenantId: session?.user.tenantId ?? null,
      token: session?.accessToken ?? null,
      user: session?.user ?? null
    }),
    [api, authMessage, clearAuthMessage, isHydrating, login, logout, session]
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
