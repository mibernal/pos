import { Suspense, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppShellLayout, AppTopbar } from '../components/layout';
import { Banner, ShellMessage } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoginScreen, RequireSession, useSession, ReauthModal } from '../features/auth';
import { CloseCashSessionModal, CashMovementModal } from '../features/cash-sessions';
import { BranchSetupScreen } from '../features/branches';
import { DianConfigModal, TicketTemplateModal, SetPinModal } from '../features/settings';
import { UpgradePlanModal } from '../features/billing/components/UpgradePlanModal';
import {
  usePendingSalesSync,
  usePosNavigation,
  useTenantTaxMode,
  useTicketTemplate,
  usePosStore
} from '../hooks';
import { pathForRoute } from './routes';
import type { ShellContext } from './shell-context';

/**
 * El armazón de la aplicación.
 *
 * Ya no decide qué pantalla se ve —eso lo decide la URL— sino que prepara lo que cualquier
 * pantalla puede necesitar y lo deja en el contexto del `Outlet`. Lo que antes eran
 * doscientas líneas de `else if` con las props de cada pantalla enhebradas a mano vive ahora
 * en `route-elements.tsx`, una función por ruta.
 */
export function AppShell() {
  const { api, logout, session, refreshSession } = useSession();
  const { commitPosContext, posContext } = usePosStore();
  const { activeRoute, navigate, resetNavigation, routeDefinitions, defaultRoute } = usePosNavigation(
    session?.user ?? null
  );
  const location = useLocation();
  const activeRouteLabel = routeDefinitions.find((r) => r.id === activeRoute)?.label ?? 'esta pantalla';

  const {
    isOnline,
    pendingSales,
    pendingSalesCount,
    refreshPendingSalesCount,
    retryPendingSale,
    syncError,
    syncMessage,
    syncPendingSales,
    syncingPendingSaleIds,
    syncingPendingSales
  } = usePendingSalesSync({ api, posContext, session });

  const { ticketTemplate, saveTicketTemplate } = useTicketTemplate({ api, posContext, session });
  const { tenantTaxMode, setTenantTaxMode } = useTenantTaxMode({ api, session });

  const [isTicketTemplateModalOpen, setIsTicketTemplateModalOpen] = useState(false);
  const [isSetPinModalOpen, setIsSetPinModalOpen] = useState(false);
  const [isDianConfigModalOpen, setIsDianConfigModalOpen] = useState(false);
  const [isCloseSessionModalOpen, setIsCloseSessionModalOpen] = useState(false);
  const [isCashMovementModalOpen, setIsCashMovementModalOpen] = useState(false);

  useEffect(() => {
    if (!session && posContext) {
      commitPosContext(null);
    }
  }, [commitPosContext, posContext, session]);

  const shell: ShellContext = useMemo(
    () => ({
      api,
      session: session!,
      posContext,
      ticketTemplate,
      tenantTaxMode,
      isOnline,
      pendingSales,
      syncingPendingSaleIds,
      syncingPendingSales,
      refreshPendingSalesCount,
      retryPendingSale: (recordId: string) => void retryPendingSale(recordId),
      syncPendingSales: () => void syncPendingSales(),
      navigateTo: navigate
    }),
    [
      api,
      session,
      posContext,
      ticketTemplate,
      tenantTaxMode,
      isOnline,
      pendingSales,
      syncingPendingSaleIds,
      syncingPendingSales,
      refreshPendingSalesCount,
      retryPendingSale,
      syncPendingSales,
      navigate
    ]
  );

  function handleLogout() {
    logout();
    resetNavigation();
  }

  return (
    <RequireSession
      loadingFallback={<ShellMessage title="Validando sesión..." subtitle="Preparando entorno POS" />}
      fallback={<LoginScreen />}
    >
      {!posContext && !session?.user.isPlatformRole ? (
        <BranchSetupScreen
          api={api}
          session={session!}
          onReady={(context) => {
            commitPosContext(context);
            /**
             * Solo se redirige a quien no venía a ninguna parte.
             *
             * Elegir caja es un paso previo, no un destino: si alguien abrió un enlace a
             * Productos y de camino tuvo que confirmar su terminal, mandarlo al POS después
             * convierte cualquier enlace directo en «te llevo a la pantalla de siempre», que
             * es justo lo que esta fase viene a arreglar.
             */
            if (location.pathname === '/') resetNavigation();
          }}
        />
      ) : (
        <AppShellLayout
          header={
            <AppTopbar
              activeRoute={activeRoute}
              branchId={posContext?.branchId ?? ''}
              branchName={posContext?.branchName}
              cashSessionId={posContext?.cashSessionId ?? ''}
              onChangeRegister={() => commitPosContext(null)}
              onCloseRegister={() => setIsCloseSessionModalOpen(true)}
              onLogout={handleLogout}
              onNavigate={navigate}
              onOpenDianConfig={() => setIsDianConfigModalOpen(true)}
              onOpenTicketTemplate={() => setIsTicketTemplateModalOpen(true)}
              onOpenSetPin={() => setIsSetPinModalOpen(true)}
              onOpenCashMovements={() => setIsCashMovementModalOpen(true)}
              onSyncPendingSales={() => void syncPendingSales()}
              pendingSalesCount={pendingSalesCount}
              routeDefinitions={routeDefinitions}
              session={session!}
              syncingPendingSales={syncingPendingSales}
            />
          }
        >
          {session?.user?.isImpersonating && (
            <div style={{ padding: '0.75rem 1.5rem', backgroundColor: 'var(--color-warning-500)', color: 'black', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600 }}>
              <span>⚠️ Estás viendo la plataforma como {session?.user.name} (Modo Suplantación)</span>
              <button
                onClick={async () => {
                  await api.stopImpersonating();
                  window.location.href = pathForRoute('platform');
                }}
                style={{ background: 'black', color: 'white', border: 'none', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Dejar de Suplantar
              </button>
            </div>
          )}
          {syncMessage ? <Banner tone="info">{syncMessage}</Banner> : null}
          {syncError ? <Banner tone="error">{syncError}</Banner> : null}

          {/* Barrera por pantalla: un fallo en Reportes no debe tumbar el POS. La clave por
              ruta reinicia la barrera al navegar, para que la pantalla siguiente no herede
              el estado de error de la anterior. */}
          <ErrorBoundary key={activeRoute} scope={activeRouteLabel}>
            <Suspense fallback={<ShellMessage title="Cargando módulo..." subtitle="Preparando vista" />}>
              {location.pathname === '/' ? (
                // La raíz manda a donde el usuario trabaja: al salón si tiene mesas, a la
                // caja si no, y a la plataforma si es del equipo.
                <Navigate to={pathForRoute(defaultRoute)} replace />
              ) : (
                <Outlet context={shell} />
              )}
            </Suspense>
          </ErrorBoundary>

          <TicketTemplateModal
            api={api}
            isOpen={isTicketTemplateModalOpen}
            onClose={() => setIsTicketTemplateModalOpen(false)}
            onSave={saveTicketTemplate}
            template={ticketTemplate}
            session={session!}
            refreshSession={refreshSession}
          />

          <DianConfigModal
            api={api}
            isOpen={isDianConfigModalOpen}
            onClose={() => setIsDianConfigModalOpen(false)}
            onSaved={setTenantTaxMode}
          />

          <SetPinModal api={api} isOpen={isSetPinModalOpen} onClose={() => setIsSetPinModalOpen(false)} />

          {posContext && (
            <CloseCashSessionModal
              api={api}
              isOpen={isCloseSessionModalOpen}
              sessionId={posContext.cashSessionId}
              ticketTemplate={ticketTemplate}
              branchName={posContext.branchName ?? posContext.branchId}
              onClose={() => setIsCloseSessionModalOpen(false)}
              onSuccess={() => {
                setIsCloseSessionModalOpen(false);
                commitPosContext(null);
                resetNavigation();
              }}
            />
          )}
          {posContext && (
            <CashMovementModal
              api={api}
              isOpen={isCashMovementModalOpen}
              sessionId={posContext.cashSessionId}
              onClose={() => setIsCashMovementModalOpen(false)}
              onSuccess={() => {
                setIsCashMovementModalOpen(false);
                alert('Movimiento registrado correctamente');
              }}
            />
          )}

          <UpgradePlanModal />
        </AppShellLayout>
      )}
      <ReauthModal />
    </RequireSession>
  );
}
