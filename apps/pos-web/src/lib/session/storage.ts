import type { AuthSession, AuthUser } from '../api';

const USER_KEY = 'pos-dian:web:auth-user';
const POS_CONTEXT_KEY = 'pos-dian:web:pos-context';

export interface PosContext {
  branchId: string;
  branchName: string;
  branchAddress?: string;
  terminalId: string;
  terminalName: string;
  cashSessionId: string;
}

export function readAuthUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function writeAuthUser(user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  if (!user) {
    window.localStorage.removeItem(USER_KEY);
    return;
  }
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function readAuthSession(): AuthSession | null {
  // Session is now memory-only. On load, the app must call /auth/refresh to restore it.
  return null;
}

export function writeAuthSession(_session: AuthSession | null): void {
  // Session is now memory-only.
}

export function readPosContext(): PosContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(POS_CONTEXT_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PosContext;
  } catch {
    return null;
  }
}

export function writePosContext(context: PosContext | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!context) {
    window.localStorage.removeItem(POS_CONTEXT_KEY);
    return;
  }

  window.localStorage.setItem(POS_CONTEXT_KEY, JSON.stringify(context));
}
