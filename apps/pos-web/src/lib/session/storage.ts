import type { AuthSession } from '../api';

const SESSION_KEY = 'pos-dian:web:auth-session';
const POS_CONTEXT_KEY = 'pos-dian:web:pos-context';

export interface PosContext {
  branchId: string;
  branchName?: string;
  branchAddress?: string;
  cashSessionId: string;
}

function isStoredAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const accessToken = (value as { accessToken?: unknown }).accessToken;
  const user = (value as { user?: unknown }).user;

  if (typeof accessToken !== 'string' || !user || typeof user !== 'object') {
    return false;
  }

  const id = (user as { id?: unknown }).id;
  const tenantId = (user as { tenantId?: unknown }).tenantId;
  const taxMode = (user as { taxMode?: unknown }).taxMode;
  const role = (user as { role?: unknown }).role;
  const email = (user as { email?: unknown }).email;
  const name = (user as { name?: unknown }).name;
  const active = (user as { active?: unknown }).active;

  return (
    typeof id === 'string' &&
    typeof tenantId === 'string' &&
    (taxMode === undefined || taxMode === 'IVA' || taxMode === 'INC_RESTAURANT') &&
    typeof role === 'string' &&
    typeof email === 'string' &&
    typeof name === 'string' &&
    typeof active === 'boolean'
  );
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isStoredAuthSession(parsed)
      ? {
          accessToken: parsed.accessToken,
          user: parsed.user
        }
      : null;
  } catch {
    return null;
  }
}

export function writeAuthSession(session: AuthSession | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }

  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: session.accessToken,
      user: session.user
    } satisfies AuthSession)
  );
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
