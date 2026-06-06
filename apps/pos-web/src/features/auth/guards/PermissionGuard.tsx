import type { ReactNode } from 'react';
import { useSession } from '../context/SessionProvider';

export function PermissionGuard({
  allowedPermissions,
  children,
  fallback = null,
  requireAll = false
}: {
  allowedPermissions: readonly string[];
  children: ReactNode;
  fallback?: ReactNode;
  requireAll?: boolean;
}) {
  const { user } = useSession();

  const isPlatformOwner = user?.role === 'PLATFORM_OWNER';
  const isTenantAdmin = user?.role === 'ADMIN' || user?.role === 'TENANT_OWNER';
  const hasPlatformPerms = allowedPermissions.some(p => p.startsWith('platform:'));

  // Espejo de la lógica del backend: TENANT_OWNER y ADMIN bypass para todo EXCEPTO permisos de platform
  const isBypassRole = isPlatformOwner || (isTenantAdmin && !hasPlatformPerms);

  const hasPermission = user?.permissions && (
    requireAll 
      ? allowedPermissions.every(p => user.permissions?.includes(p))
      : allowedPermissions.some(p => user.permissions?.includes(p))
  );

  if (!isBypassRole && !hasPermission) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
