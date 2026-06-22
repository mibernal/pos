import type { AppRoute, AppRouteDefinition } from '../../types';

export function MobileDrawer({
  isOpen,
  onClose,
  routeDefinitions,
  activeRoute,
  onNavigate,
  onLogout
}: {
  isOpen: boolean;
  onClose: () => void;
  routeDefinitions: readonly AppRouteDefinition[];
  activeRoute: AppRoute;
  onNavigate: (routeId: AppRoute) => void;
  onLogout: () => void;
}) {
  if (!isOpen) return null;

  const handleMobileNavigate = (routeId: AppRoute) => {
    onNavigate(routeId);
    onClose();
  };

  return (
    <div className="mobile-drawer-overlay" onClick={onClose}>
      <div className="mobile-drawer-panel" onClick={e => e.stopPropagation()}>
        <div className="mobile-drawer-header">
          <h2>Navegación</h2>
          <button className="ghost-button" onClick={onClose} aria-label="Cerrar menú">
            ✕
          </button>
        </div>
        <nav className="mobile-drawer-nav">
          {routeDefinitions.map((route) => (
            <button
              key={route.id}
              className={`mobile-nav-btn ${activeRoute === route.id ? 'active' : ''}`}
              onClick={() => handleMobileNavigate(route.id)}
            >
              {route.label}
            </button>
          ))}
        </nav>
        <div className="mobile-drawer-footer">
          <button className="danger-button" style={{ width: '100%' }} onClick={() => {
            onClose();
            onLogout();
          }}>
            Cerrar sesión 🚪
          </button>
        </div>
      </div>
    </div>
  );
}
