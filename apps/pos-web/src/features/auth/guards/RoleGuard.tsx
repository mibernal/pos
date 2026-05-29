import type { ReactNode } from 'react';
import type { UserRole } from '../../../lib/api';
import { useSession } from '../context/SessionProvider';

export function RoleGuard({
  allowedRoles,
  allowedPermissions,
  children,
  fallback = null
}: {
  allowedRoles?: readonly UserRole[];
  allowedPermissions?: readonly string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role, user } = useSession();

  const hasRole = role && allowedRoles?.includes(role);
  const hasPermission = user?.permissions && allowedPermissions?.some(p => user.permissions?.includes(p));

  if (!hasRole && !hasPermission && role !== 'ADMIN') {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
