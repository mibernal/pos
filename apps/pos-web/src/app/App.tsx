import { useEffect, useState, type ReactNode } from 'react';
import { AppShellLayout, AppTopbar } from '../components/layout';
import { Banner, ShellMessage } from '../components/ui';
import { LoginScreen, RequireSession, SessionProvider, useSession } from '../features/auth';
import { CloseCashSessionModal, CashControlScreen, CashMovementModal } from '../features/cash-sessions';
import { CustomersScreen } from '../features/customers';
import { BranchSetupScreen } from '../features/branches';
import { HistoryScreen } from '../features/history';
import { InventoryScreen, InventoryAdjustmentsScreen } from '../features/inventory';
import { ProductsScreen } from '../features/products';
import { ReportsScreen, DashboardScreen } from '../features/reports';


import { PosScreen } from '../features/sales';
import { DianConfigModal, TicketTemplateModal } from '../features/settings';
import {
  usePendingSalesSync,
  usePosContextState,
  usePosNavigation,
  useTenantTaxMode,
  useTicketTemplate
} from '../hooks';

function AppShell() {
  const { api, logout, session } = useSession();
  const { commitPosContext, posContext } = usePosContextState();
  const { activeRoute, navigate, resetNavigation, routeDefinitions } = usePosNavigation(session?.user.role ?? null);
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
  } = usePendingSalesSync({
    api,
    posContext,
    session
  });
  const { ticketTemplate, saveTicketTemplate } = useTicketTemplate({
    api,
    posContext,
    session
  });
  const { tenantTaxMode, setTenantTaxMode } = useTenantTaxMode({
    api,
    session
  });
  const [isTicketTemplateModalOpen, setIsTicketTemplateModalOpen] = useState(false);
  const [isDianConfigModalOpen, setIsDianConfigModalOpen] = useState(false);
  const [isCloseSessionModalOpen, setIsCloseSessionModalOpen] = useState(false);
  const [isCashMovementModalOpen, setIsCashMovementModalOpen] = useState(false);

  useEffect(() => {
    if (!session && posContext) {
      commitPosContext(null);
    }
  }, [commitPosContext, posContext, session]);

  function handleLogout() {
    logout();
    resetNavigation();
  }

  return (
    <RequireSession
      loadingFallback={<ShellMessage title="Validando sesión..." subtitle="Preparando entorno POS" />}
      fallback={<LoginScreen />}
    >
      {!posContext || !session ? (
        <BranchSetupScreen
          api={api}
          session={session}
          onReady={(context) => {
            commitPosContext(context);
            resetNavigation();
          }}
        />
      ) : (
        (() => {
          let currentScreen: ReactNode = null;

          if (activeRoute === 'pos') {
            currentScreen = (
              <PosScreen
                api={api}
                branchId={posContext.branchId}
                cashSessionId={posContext.cashSessionId}
                branchName={posContext.branchName ?? posContext.branchId}
                branchAddress={posContext.branchAddress}
                ticketTemplate={ticketTemplate}
                tenantTaxMode={tenantTaxMode}
                isOnline={isOnline}
                onSaleQueued={async () => {
                  await refreshPendingSalesCount();
                }}
                onRetryPendingSale={(recordId) => void retryPendingSale(recordId)}
                onSyncPendingSales={() => void syncPendingSales()}
                pendingSales={pendingSales}
                syncingPendingSaleIds={syncingPendingSaleIds}
                syncingPendingSales={syncingPendingSales}
              />
            );
          }

          if (activeRoute === 'history') {
            currentScreen = (
              <HistoryScreen
                api={api}
                branchId={posContext.branchId}
                branchName={posContext.branchName ?? posContext.branchId}
                branchAddress={posContext.branchAddress}
                ticketTemplate={ticketTemplate}
                tenantTaxMode={tenantTaxMode}
              />
            );
          }

          if (activeRoute === 'cash-control') {
            currentScreen = (
              <CashControlScreen
                api={api}
                branchId={posContext.branchId}
                cashSessionId={posContext.cashSessionId}
              />
            );
          }

          if (activeRoute === 'products') {
            currentScreen = <ProductsScreen api={api} branchId={posContext.branchId} />;
          }

          if (activeRoute === 'customers') {
            currentScreen = <CustomersScreen api={api} />;
          }

          if (activeRoute === 'inventory') {
            currentScreen = <InventoryScreen api={api} branchId={posContext.branchId} />;
          }

          if (activeRoute === 'inventory-adjustments') {
            currentScreen = <InventoryAdjustmentsScreen api={api} branchId={posContext.branchId} />;
          }

          if (activeRoute === 'reports') {
            currentScreen = <ReportsScreen api={api} branchId={posContext.branchId} />;
          }

          if (activeRoute === 'dashboard') {
            currentScreen = <DashboardScreen api={api} branchId={posContext.branchId} />;
          }

          return (
            <AppShellLayout
              header={
                <AppTopbar
                  activeRoute={activeRoute}
                  branchId={posContext.branchId}
                  branchName={posContext.branchName}
                  cashSessionId={posContext.cashSessionId}
                  onChangeRegister={() => commitPosContext(null)}
                  onCloseRegister={() => setIsCloseSessionModalOpen(true)}
                  onLogout={handleLogout}
                  onNavigate={navigate}
                  onOpenDianConfig={() => setIsDianConfigModalOpen(true)}
                  onOpenTicketTemplate={() => setIsTicketTemplateModalOpen(true)}
                  onOpenCashMovements={() => setIsCashMovementModalOpen(true)}
                  onSyncPendingSales={() => void syncPendingSales()}
                  pendingSalesCount={pendingSalesCount}
                  routeDefinitions={routeDefinitions}
                  session={session}
                  syncingPendingSales={syncingPendingSales}
                />
              }
            >
              {syncMessage ? <Banner tone="info">{syncMessage}</Banner> : null}
              {syncError ? <Banner tone="error">{syncError}</Banner> : null}
              {currentScreen}

              <TicketTemplateModal
                api={api}
                isOpen={isTicketTemplateModalOpen}
                onClose={() => setIsTicketTemplateModalOpen(false)}
                onSave={saveTicketTemplate}
                template={ticketTemplate}
              />

              <DianConfigModal
                api={api}
                isOpen={isDianConfigModalOpen}
                onClose={() => setIsDianConfigModalOpen(false)}
                onSaved={setTenantTaxMode}
              />

              {posContext && (
                <CloseCashSessionModal
                  api={api}
                  isOpen={isCloseSessionModalOpen}
                  sessionId={posContext.cashSessionId}
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
            </AppShellLayout>
          );
        })()
      )}
    </RequireSession>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}
