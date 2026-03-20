import type { AuthSession } from '../../lib/api';
import type { AppRoute, AppRouteDefinition } from '../../types';

export function AppTopbar({
  activeRoute,
  branchId,
  branchName,
  cashSessionId,
  onChangeRegister,
  onLogout,
  onNavigate,
  onOpenDianConfig,
  onOpenTicketTemplate,
  onSyncPendingSales,
  pendingSalesCount,
  routeDefinitions,
  session,
  syncingPendingSales
}: {
  activeRoute: AppRoute;
  branchId: string;
  branchName?: string;
  cashSessionId: string;
  onChangeRegister: () => void;
  onLogout: () => void;
  onNavigate: (route: AppRoute) => void;
  onOpenDianConfig: () => void;
  onOpenTicketTemplate: () => void;
  onSyncPendingSales: () => void;
  pendingSalesCount: number;
  routeDefinitions: readonly AppRouteDefinition[];
  session: AuthSession;
  syncingPendingSales: boolean;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <h1>POS DIAN</h1>
        <p>
          {branchName ?? branchId} • Caja {cashSessionId.slice(0, 8)}
        </p>
      </div>

      <nav className="topbar-nav">
        {routeDefinitions.map((route) => (
          <button
            key={route.id}
            className={activeRoute === route.id ? 'nav-btn active' : 'nav-btn'}
            onClick={() => onNavigate(route.id)}
          >
            {route.label}
          </button>
        ))}
      </nav>

      <div className="topbar-user">
        <div>
          <strong>{session.user.name}</strong>
          <p>{session.user.role}</p>
        </div>
        <div className="pending-sync">
          <span className={`tag ${pendingSalesCount > 0 ? 'tag-warning' : 'tag-success'}`}>
            Pendientes {pendingSalesCount}
          </span>
          <button
            className="ghost-button"
            onClick={onSyncPendingSales}
            disabled={syncingPendingSales || pendingSalesCount === 0}
          >
            {syncingPendingSales ? 'Sincronizando...' : 'Sincronizar'}
          </button>
        </div>
        {session.user.role === 'ADMIN' ? (
          <>
            <button className="ghost-button" onClick={onOpenTicketTemplate}>
              Configuración negocio
            </button>
            <button className="ghost-button" onClick={onOpenDianConfig}>
              Configuración DIAN
            </button>
          </>
        ) : null}
        <button className="ghost-button" onClick={onChangeRegister}>
          Cambiar caja
        </button>
        <button className="ghost-button" onClick={onLogout}>
          Salir
        </button>
      </div>
    </header>
  );
}
