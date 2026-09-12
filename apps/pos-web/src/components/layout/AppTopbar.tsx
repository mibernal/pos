import { useState } from 'react';
import type { AuthSession } from '../../lib/api';
import type { AppRoute, AppRouteDefinition } from '../../types';
import { MobileDrawer, type TopbarAction } from './MobileDrawer';
import { useTablesStore } from '../../features/tables/store/useTablesStore';

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
  onOpenSetPin,
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
  onOpenSetPin: () => void;
  onOpenCashMovements: () => void;
  onCloseRegister: () => void;
  onSyncPendingSales: () => void;
  pendingSalesCount: number;
  routeDefinitions: readonly AppRouteDefinition[];
  session: AuthSession;
  syncingPendingSales: boolean;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const irA = (routeId: AppRoute) => {
    if (routeId === 'pos') {
      useTablesStore.getState().setActiveTable(null);
    }
    onNavigate(routeId);
  };

  const handleMobileNavigate = (routeId: AppRoute) => {
    if (routeId === 'pos') {
      useTablesStore.getState().setActiveTable(null);
    }
    onNavigate(routeId);
    setIsMobileMenuOpen(false);
  };

  /**
   * Las acciones de la barra, declaradas una sola vez.
   *
   * Antes estaban escritas a mano dentro del `<header>`, siete botones envueltos en cuatro
   * condiciones de permiso. Ahí no cabían: en una línea miden más que un teléfono entero, y
   * los últimos quedaban fuera de la ventana sin barra de desplazamiento que lo delatara.
   * Un botón que no se ve es una función que el usuario jura que no existe.
   *
   * Declararlas como datos permite dibujarlas de dos maneras —iconos en la barra cuando hay
   * sitio, filas con su nombre en el cajón cuando no— sin duplicar las condiciones de
   * permiso, que es donde un descuido se convierte en un agujero.
   */
  const puede = (...roles: string[]) =>
    !session.user.isPlatformRole && roles.includes(session.user.role);

  const actions: TopbarAction[] = [
    ...(puede('ADMIN', 'TENANT_OWNER', 'MANAGER')
      ? [
          { id: 'pin', icon: '🔑', label: 'PIN de aprobación', onClick: onOpenSetPin },
          { id: 'negocio', icon: '⚙️', label: 'Configuración de negocio', onClick: onOpenTicketTemplate }
        ]
      : []),
    ...(puede('ADMIN', 'TENANT_OWNER')
      ? [{ id: 'dian', icon: '📄', label: 'Configuración DIAN', onClick: onOpenDianConfig }]
      : []),
    ...(!session.user.isPlatformRole &&
    (session.user.role === 'ADMIN' ||
      session.user.role === 'TENANT_OWNER' ||
      session.user.permissions?.includes('cash:reconcile') ||
      session.user.permissions?.includes('cash:audit'))
      ? [{ id: 'movimientos', icon: '💸', label: 'Ingreso / egreso de caja', onClick: onOpenCashMovements }]
      : []),
    ...(!session.user.isPlatformRole
      ? [
          { id: 'cambiar-caja', icon: '🔁', label: 'Cambiar caja', onClick: onChangeRegister },
          { id: 'cerrar-caja', icon: '🔒', label: 'Cerrar caja', onClick: onCloseRegister, tone: 'danger' as const }
        ]
      : [])
  ];

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <button 
            className="mobile-menu-trigger ghost-button" 
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menú"
            title="Abrir menú"
          >
            ☰
          </button>
          <div className="brand-logo">
            <h1 className="text-gradient">POS DIAN</h1>
          </div>
          <div className="brand-info">
            {session.user.isPlatformRole ? (
              <strong>SaaS Platform</strong>
            ) : (
              <>
                <strong>{branchName ?? branchId}</strong>
                <p>Caja: {cashSessionId.slice(0, 8)}</p>
              </>
            )}
          </div>
        </div>

        {/**
         * Todas las rutas a la vista, sin desplegable.
         *
         * Hubo un «Más» que dejaba en la barra solo las seis del turno y escondía el resto:
         * ahorraba unos 100 px de alto, pero costaba un clic en cada salto a Productos,
         * Clientes o Reportes. Para quien trabaja aquí todo el día, ver la lista completa
         * gana a recuperar ese alto — decisión de Miguel, y la barra envuelve en dos filas
         * a propósito.
         */}
        <nav className="topbar-nav">
          {routeDefinitions.map((route) => (
            <button
              key={route.id}
              className={`nav-btn ${activeRoute === route.id ? 'active' : ''}`}
              onClick={() => irA(route.id)}
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

          {!session.user.isPlatformRole && (
            <div className="pending-sync">
              <span className={`tag ${pendingSalesCount > 0 ? 'tag-warning' : 'tag-success'}`}>
                {pendingSalesCount} {pendingSalesCount === 1 ? 'pendiente' : 'pendientes'}
              </span>
              <button
                className="ghost-button"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
                onClick={onSyncPendingSales}
                disabled={syncingPendingSales || pendingSalesCount === 0}
                // Un botón cuyo contenido es solo un emoji no tiene nombre accesible: un
                // lector de pantalla anunciaba «botón» a secas.
                aria-label={syncingPendingSales ? 'Sincronizando ventas pendientes' : 'Sincronizar ventas pendientes'}
              >
                {syncingPendingSales ? '...' : '🔄'}
              </button>
            </div>
          )}

          {/* Por debajo de 1024 px este bloque se oculta y las mismas acciones aparecen,
              con su nombre escrito, dentro del cajón. Por eso no lleva `style` en línea:
              un `display: flex` puesto aquí ganaría por especificidad a la consulta de
              medios y el bloque seguiría dibujándose, encogido y fuera de la ventana. */}
          <div className="topbar-actions">
            {actions.map((action) => (
              <button
                key={action.id}
                className="ghost-button"
                onClick={action.onClick}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
              </button>
            ))}
            <button
              className="danger-button topbar-logout-btn"
              onClick={onLogout}
              title="Cerrar sesión / Cambiar Usuario"
            >
              <span>Cambiar Usuario</span> 🚪
            </button>
          </div>
        </div>
      </header>

      <MobileDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        routeDefinitions={routeDefinitions}
        activeRoute={activeRoute}
        onNavigate={handleMobileNavigate}
        onLogout={onLogout}
        actions={actions}
      />
    </>
  );
}
