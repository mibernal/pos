import type { ReactNode } from 'react';
import { useSession } from '../context/SessionProvider';

export function RequireSession({
  children,
  fallback,
  loadingFallback
}: {
  children: ReactNode;
  fallback: ReactNode;
  loadingFallback?: ReactNode;
}) {
  const { isAuthenticated, isHydrating } = useSession();

  if (isHydrating) {
    return <>{loadingFallback ?? null}</>;
  }

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
