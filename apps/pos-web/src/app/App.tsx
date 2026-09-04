import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { AppShellLayout, AppTopbar } from '../components/layout';
import { Banner, ShellMessage } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoginScreen, RequireSession, SessionProvider, useSession, PermissionGuard, ReauthModal } from '../features/auth';
import { CloseCashSessionModal, CashControlScreen, CashMovementModal } from '../features/cash-sessions';
import { BranchSetupScreen } from '../features/branches';
import { PosScreen } from '../features/sales';
const TablesScreen = lazy(() => import('../features/tables/TablesScreen').then(m => ({ default: m.TablesScreen })));
const WaitersScreen = lazy(() => import('../features/tables/WaitersScreen').then(m => ({ default: m.WaitersScreen })));
const KitchenScreen = lazy(() => import('../features/kds/KitchenScreen').then(m => ({ default: m.KitchenScreen })));
const ReservationsScreen = lazy(() => import('../features/reservations/ReservationsScreen').then(m => ({ default: m.ReservationsScreen })));
const DeliveryScreen = lazy(() => import('../features/sales').then(m => ({ default: m.DeliveryScreen })));
import { DianConfigModal, TicketTemplateModal, SetPinModal, QRMenuScreen } from '../features/settings';
import { BillingScreen } from '../features/billing/BillingScreen';
import { UpgradePlanModal } from '../features/billing/components/UpgradePlanModal';
import { FeatureModuleProvider, ModuleGuard } from '../features/modules';
import { PublicMenuScreen } from '../features/public-menu/PublicMenuScreen';

// Lazy Loaded Screens
const CustomersScreen = lazy(() => import('../features/customers').then(m => ({ default: m.CustomersScreen })));
const PaymentMethodsPanel = lazy(() => import('../features/settings/components/PaymentMethodsPanel').then(m => ({ default: m.PaymentMethodsPanel })));
const HistoryScreen = lazy(() => import('../features/history').then(m => ({ default: m.HistoryScreen })));
const InventoryScreen = lazy(() => import('../features/inventory').then(m => ({ default: m.InventoryScreen })));
const RecipesScreen = lazy(() => import('../features/inventory').then(m => ({ default: m.RecipesScreen })));
const BulkImportScreen = lazy(() => import('../features/inventory/BulkImportScreen').then(m => ({ default: m.BulkImportScreen })));
const ProductsScreen = lazy(() => import('../features/products').then(m => ({ default: m.ProductsScreen })));
const PromotionsScreen = lazy(() => import('../features/promotions/PromotionsScreen').then(m => ({ default: m.PromotionsScreen })));
const ReportsScreen = lazy(() => import('../features/reports').then(m => ({ default: m.ReportsScreen })));
const BranchesScreen = lazy(() => import('../features/settings').then(m => ({ default: m.BranchesScreen })));
const UsersScreen = lazy(() => import('../features/settings').then(m => ({ default: m.UsersScreen })));
const PlatformScreen = lazy(() => import('../features/platform').then(m => ({ default: m.PlatformScreen })));
import {
  usePendingSalesSync,
  usePosNavigation,
  useTenantTaxMode,
  useTicketTemplate,
  usePosStore
} from '../hooks';

function AppShell() {
  const { api, logout, session, refreshSession } = useSession();
  const { commitPosContext, posContext } = usePosStore();
  const { activeRoute, navigate, resetNavigation, routeDefinitions } = usePosNavigation(session?.user ?? null);
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
  const [isSetPinModalOpen, setIsSetPinModalOpen] = useState(false);
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
      {!posContext && !session?.user.isPlatformRole ? (
        <BranchSetupScreen
          api={api}
          session={session!}
          onReady={(context) => {
            commitPosContext(context);
            resetNavigation();
          }}
        />
      ) : (
        (() => {
          let currentScreen: ReactNode = null;

          if (activeRoute === 'platform') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['platform:tenants:create']}>
                <PlatformScreen api={api} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'pos' && posContext) {
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
                onNavigate={navigate}
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
          } else if (activeRoute === 'history' && posContext) {
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
          } else if (activeRoute === 'cash-control' && posContext) {
            currentScreen = (
              <CashControlScreen
                api={api}
                branchId={posContext.branchId}
                cashSessionId={posContext.cashSessionId}
              />
            );
          } else if (activeRoute === 'tables' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['sales:create']} requireAll={false}>
                <ModuleGuard module="tables">
                  <TablesScreen onNavigate={navigate} />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'kds' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['sales:create']} requireAll={false}>
                <ModuleGuard module="kitchen">
                  <KitchenScreen branchId={posContext.branchId} />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'reservations' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['sales:create']} requireAll={false}>
                <ModuleGuard module="reservations">
                  <ReservationsScreen api={api} branchId={posContext.branchId} />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'delivery' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['sales:create']} requireAll={false}>
                <ModuleGuard module="delivery">
                  <DeliveryScreen />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'products' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['products:view']} requireAll={false}>
                <ProductsScreen api={api} branchId={posContext.branchId} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'promotions' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['products:manage']} requireAll={false}>
                <PromotionsScreen api={api} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'payment-methods') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['settings:manage']} requireAll={false}>
                <div className="max-w-5xl mx-auto p-4 md:p-8">
                  <header className="mb-6">
                    <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Medios de pago</h1>
                    <p className="text-muted-foreground">
                      Qué puede cobrar tu caja y cómo entra cada cosa al cierre del turno.
                    </p>
                  </header>
                  <PaymentMethodsPanel api={api} />
                </div>
              </PermissionGuard>
            );
          } else if (activeRoute === 'customers' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['customers:view']} requireAll={false}>
                <CustomersScreen api={api} branchId={posContext.branchId} cashSessionId={posContext.cashSessionId ?? null} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'inventory' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['inventory:view', 'inventory:adjust', 'inventory:transfer', 'inventory:receive']} requireAll={false}>
                <InventoryScreen api={api} branchId={posContext.branchId} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'recipes' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['inventory:view']} requireAll={false}>
                <ModuleGuard module="inventory">
                  <RecipesScreen api={api} branchId={posContext.branchId} />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'bulk-import' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['products:manage', 'inventory:adjust']} requireAll={true}>
                <BulkImportScreen />
              </PermissionGuard>
            );
          } else if (activeRoute === 'reports' && posContext) {
            currentScreen = (
              <PermissionGuard allowedPermissions={['reports:view']} requireAll={false}>
                <ReportsScreen 
                  api={api} 
                  branchId={posContext.branchId} 
                  branchName={posContext.branchName ?? posContext.branchId}
                  ticketTemplate={ticketTemplate}
                />
              </PermissionGuard>
            );
          } else if (activeRoute === 'branches') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['branches:manage']}>
                <BranchesScreen api={api} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'waiters') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['branches:manage']}>
                <ModuleGuard module="waiters">
                  <WaitersScreen />
                </ModuleGuard>
              </PermissionGuard>
            );
          } else if (activeRoute === 'users') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['users:manage']}>
                <UsersScreen api={api} />
              </PermissionGuard>
            );
          } else if (activeRoute === 'billing') {
            currentScreen = <BillingScreen api={api} session={session!} />;
          } else if (activeRoute === 'qr-menu') {
            currentScreen = (
              <PermissionGuard allowedPermissions={['tenant:settings:manage']}>
                <ModuleGuard module="qr_menu">
                  <QRMenuScreen />
                </ModuleGuard>
              </PermissionGuard>
            );
          }

          return (
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
                      window.location.href = '/platform';
                    }}
                    style={{ background: 'black', color: 'white', border: 'none', padding: '0.4rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    Dejar de Suplantar
                  </button>
                </div>
              )}
              {syncMessage ? <Banner tone="info">{syncMessage}</Banner> : null}
              {syncError ? <Banner tone="error">{syncError}</Banner> : null}
              {/* Barrera por pantalla: un fallo en Reportes no debe tumbar el POS. La clave
                  por ruta reinicia la barrera al navegar, para que la pantalla siguiente no
                  herede el estado de error de la anterior. */}
              <ErrorBoundary key={activeRoute} scope={activeRouteLabel}>
                <Suspense fallback={<ShellMessage title="Cargando módulo..." subtitle="Preparando vista" />}>
                  {currentScreen}
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

              <SetPinModal
                api={api}
                isOpen={isSetPinModalOpen}
                onClose={() => setIsSetPinModalOpen(false)}
              />

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
          );
        })()
      )}
      <ReauthModal />
    </RequireSession>
  );
}
export default function App() {
  const path = window.location.pathname;
  if (path.startsWith('/menu/')) {
    const branchId = path.split('/')[2];
    if (branchId) {
      return <PublicMenuScreen branchId={branchId} />;
    }
  }

  return (
    <SessionProvider>
      <FeatureModuleProvider>
        <AppShell />
      </FeatureModuleProvider>
    </SessionProvider>
  );
}
