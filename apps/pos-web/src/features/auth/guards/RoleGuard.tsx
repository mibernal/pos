import type { ReactNode } from 'react';
import type { UserRole } from '../../../lib/api';
import { useSession } from '../context/SessionProvider';

export function RoleGuard({
  allowedRoles,
  children,
  fallback = null
}: {
  allowedRoles: readonly UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { role } = useSession();

  if (!role || !allowedRoles.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
