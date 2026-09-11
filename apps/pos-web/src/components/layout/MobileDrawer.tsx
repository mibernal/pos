import type { AppRoute, AppRouteDefinition } from '../../types';

/**
 * Una acción de la barra superior, con su nombre escrito.
 *
 * En la barra se dibuja solo el icono, porque el espacio manda. En el cajón se dibuja el
 * icono *y* la etiqueta: un cajón tiene sitio, y «🔑» a secas no le dice a nadie que ahí
 * se configura el PIN de aprobación.
 */
export type TopbarAction = {
  id: string;
  icon: string;
  label: string;
  onClick: () => void;
  tone?: 'danger';
};

export function MobileDrawer({
  isOpen,
  onClose,
  routeDefinitions,
  activeRoute,
  onNavigate,
  onLogout,
  actions = []
}: {
  isOpen: boolean;
  onClose: () => void;
  routeDefinitions: readonly AppRouteDefinition[];
  activeRoute: AppRoute;
  onNavigate: (routeId: AppRoute) => void;
  onLogout: () => void;
  actions?: readonly TopbarAction[];
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

          {actions.length > 0 && (
            <>
              <p className="mobile-drawer-section">Acciones</p>
              {actions.map((action) => (
                <button
                  key={action.id}
                  className={`mobile-nav-btn ${action.tone === 'danger' ? 'is-danger' : ''}`}
                  onClick={() => {
                    onClose();
                    action.onClick();
                  }}
                >
                  <span className="mobile-nav-icon" aria-hidden="true">{action.icon}</span>
                  {action.label}
                </button>
              ))}
            </>
          )}
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
