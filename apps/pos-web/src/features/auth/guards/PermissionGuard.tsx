import type { ReactNode } from 'react';
import { useSession } from '../context/SessionProvider';

export function PermissionGuard({
  allowedPermissions,
  children,
  fallback = null
}: {
  allowedPermissions: readonly string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { user } = useSession();

  // ADMIN bypasses all permission checks in the backend, we mirror that here
  const isAdmin = user?.role === 'ADMIN';
  const hasPermission = user?.permissions && allowedPermissions.some(p => user.permissions?.includes(p));

  if (!isAdmin && !hasPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
