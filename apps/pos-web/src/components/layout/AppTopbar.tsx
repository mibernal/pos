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
  onOpenCashMovements,
  onCloseRegister,
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
  onOpenCashMovements: () => void;
  onCloseRegister: () => void;
  onSyncPendingSales: () => void;
  pendingSalesCount: number;
  routeDefinitions: readonly AppRouteDefinition[];
  session: AuthSession;
  syncingPendingSales: boolean;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo">
          <h1 className="text-gradient">POS DIAN</h1>
        </div>
        <div className="brand-info">
          <strong>{branchName ?? branchId}</strong>
          <p>Caja: {cashSessionId.slice(0, 8)}</p>
        </div>
      </div>

      <nav className="topbar-nav">
        {routeDefinitions.map((route) => (
          <button
            key={route.id}
            className={`nav-btn ${activeRoute === route.id ? 'active' : ''}`}
            onClick={() => onNavigate(route.id)}
          >
            {route.label}
          </button>
        ))}
      </nav>

      <div className="topbar-user">
        <div className="user-profile">
          <strong>{session.user.name}</strong>
          <p className="tag-muted" style={{ margin: 0 }}>{session.user.role}</p>
        </div>

        <div className="pending-sync">
          <span className={`tag ${pendingSalesCount > 0 ? 'tag-warning' : 'tag-success'}`}>
            {pendingSalesCount} {pendingSalesCount === 1 ? 'pendiente' : 'pendientes'}
          </span>
          <button
            className="ghost-button"
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
            onClick={onSyncPendingSales}
            disabled={syncingPendingSales || pendingSalesCount === 0}
          >
            {syncingPendingSales ? '...' : '🔄'}
          </button>
        </div>

        <div className="topbar-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          {['ADMIN', 'MANAGER'].includes(session.user.role) && (
            <>
              <button className="ghost-button" onClick={onOpenTicketTemplate} title="Configuración de negocio">
                ⚙️
              </button>
              <button className="ghost-button" onClick={onOpenDianConfig} title="Configuración DIAN">
                📄
              </button>
            </>
          )}
          {(session.user.role === 'ADMIN' || session.user.permissions?.includes('cash:reconcile') || session.user.permissions?.includes('cash:audit')) && (
            <button className="ghost-button" onClick={onOpenCashMovements} title="Ingreso/Egreso de Caja">
              💸
            </button>
          )}
          <button className="ghost-button" onClick={onChangeRegister} title="Cambiar caja">
            🔁
          </button>
          <button className="ghost-button" onClick={onCloseRegister} title="Cerrar caja">
            🔒
          </button>
          <button className="danger-button" style={{ padding: '0.5rem', borderRadius: 'var(--radius-md)' }} onClick={onLogout} title="Cerrar sesión">
            🚪
          </button>
        </div>
      </div>
    </header>
  );
}
