import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useShell } from './shell-context';

/**
 * Un elemento por ruta.
 *
 * Cada uno toma del armazón lo que su pantalla necesita. Sustituye a la cadena de
 * `else if (activeRoute === 'x')` que decidía a la vez qué pantalla pintar y con qué props,
 * y que había que editar para añadir cualquier cosa.
 *
 * Las guardas no están aquí: viven en `APP_ROUTE_DEFINITIONS` y las aplica `RouteGuard`.
 */

const TablesScreen = lazy(() => import('../features/tables/TablesScreen').then((m) => ({ default: m.TablesScreen })));
const WaitersScreen = lazy(() => import('../features/tables/WaitersScreen').then((m) => ({ default: m.WaitersScreen })));
const KitchenScreen = lazy(() => import('../features/kds/KitchenScreen').then((m) => ({ default: m.KitchenScreen })));
const ReservationsScreen = lazy(() => import('../features/reservations/ReservationsScreen').then((m) => ({ default: m.ReservationsScreen })));
const DeliveryScreen = lazy(() => import('../features/sales').then((m) => ({ default: m.DeliveryScreen })));
const CustomersScreen = lazy(() => import('../features/customers').then((m) => ({ default: m.CustomersScreen })));
const PaymentMethodsPanel = lazy(() => import('../features/settings/components/PaymentMethodsPanel').then((m) => ({ default: m.PaymentMethodsPanel })));
const HistoryScreen = lazy(() => import('../features/history').then((m) => ({ default: m.HistoryScreen })));
const InventoryScreen = lazy(() => import('../features/inventory').then((m) => ({ default: m.InventoryScreen })));
const RecipesScreen = lazy(() => import('../features/inventory').then((m) => ({ default: m.RecipesScreen })));
const BulkImportScreen = lazy(() => import('../features/inventory/BulkImportScreen').then((m) => ({ default: m.BulkImportScreen })));
const ProductsScreen = lazy(() => import('../features/products').then((m) => ({ default: m.ProductsScreen })));
const PromotionsScreen = lazy(() => import('../features/promotions/PromotionsScreen').then((m) => ({ default: m.PromotionsScreen })));
const ReportsScreen = lazy(() => import('../features/reports').then((m) => ({ default: m.ReportsScreen })));
const BranchesScreen = lazy(() => import('../features/settings').then((m) => ({ default: m.BranchesScreen })));
const UsersScreen = lazy(() => import('../features/settings').then((m) => ({ default: m.UsersScreen })));
const QRMenuScreen = lazy(() => import('../features/settings').then((m) => ({ default: m.QRMenuScreen })));
const PlatformScreen = lazy(() => import('../features/platform').then((m) => ({ default: m.PlatformScreen })));
const BillingScreen = lazy(() => import('../features/billing/BillingScreen').then((m) => ({ default: m.BillingScreen })));
const CashControlScreen = lazy(() => import('../features/cash-sessions').then((m) => ({ default: m.CashControlScreen })));
const PosScreen = lazy(() => import('../features/sales').then((m) => ({ default: m.PosScreen })));

/**
 * Las pantallas del POS no existen sin sucursal y caja.
 *
 * La definición de la ruta lo declara (`requiresPosContext`) y `RouteGuard` lo hace cumplir;
 * esto es el cinturón para TypeScript, que no puede saberlo.
 */
function useRequiredPos() {
  const shell = useShell();
  return shell.posContext ? { shell, pos: shell.posContext } : null;
}

export function PosRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  const { shell, pos } = listo;

  return (
    <PosScreen
      api={shell.api}
      branchId={pos.branchId}
      cashSessionId={pos.cashSessionId}
      branchName={pos.branchName ?? pos.branchId}
      branchAddress={pos.branchAddress}
      ticketTemplate={shell.ticketTemplate}
      tenantTaxMode={shell.tenantTaxMode}
      isOnline={shell.isOnline}
      onNavigate={shell.navigateTo}
      onSaleQueued={async () => {
        await shell.refreshPendingSalesCount();
      }}
      onRetryPendingSale={(recordId: string) => shell.retryPendingSale(recordId)}
      onSyncPendingSales={() => shell.syncPendingSales()}
      pendingSales={shell.pendingSales}
      syncingPendingSaleIds={shell.syncingPendingSaleIds}
      syncingPendingSales={shell.syncingPendingSales}
    />
  );
}

export function HistoryRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  const { shell, pos } = listo;

  return (
    <HistoryScreen
      api={shell.api}
      branchId={pos.branchId}
      branchName={pos.branchName ?? pos.branchId}
      branchAddress={pos.branchAddress}
      ticketTemplate={shell.ticketTemplate}
      tenantTaxMode={shell.tenantTaxMode}
    />
  );
}

export function CashControlRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <CashControlScreen api={listo.shell.api} branchId={listo.pos.branchId} cashSessionId={listo.pos.cashSessionId} />;
}

export function TablesRoute() {
  const shell = useShell();
  return <TablesScreen onNavigate={shell.navigateTo} />;
}

export function KdsRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <KitchenScreen branchId={listo.pos.branchId} />;
}

export function ReservationsRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <ReservationsScreen api={listo.shell.api} branchId={listo.pos.branchId} />;
}

export function DeliveryRoute() {
  return <DeliveryScreen />;
}

export function ProductsRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <ProductsScreen api={listo.shell.api} branchId={listo.pos.branchId} />;
}

export function PromotionsRoute() {
  return <PromotionsScreen api={useShell().api} />;
}

export function PaymentMethodsRoute() {
  const shell = useShell();
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Medios de pago</h1>
        <p className="text-muted-foreground">
          Qué puede cobrar tu caja y cómo entra cada cosa al cierre del turno.
        </p>
      </header>
      <PaymentMethodsPanel api={shell.api} />
    </div>
  );
}

export function CustomersRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return (
    <CustomersScreen
      api={listo.shell.api}
      branchId={listo.pos.branchId}
      cashSessionId={listo.pos.cashSessionId ?? null}
    />
  );
}

export function InventoryRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <InventoryScreen api={listo.shell.api} branchId={listo.pos.branchId} />;
}

export function RecipesRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  return <RecipesScreen api={listo.shell.api} branchId={listo.pos.branchId} />;
}

export function BulkImportRoute() {
  return <BulkImportScreen />;
}

export function ReportsRoute() {
  const listo = useRequiredPos();
  if (!listo) return <Navigate to="/" replace />;
  const { shell, pos } = listo;
  return (
    <ReportsScreen
      api={shell.api}
      branchId={pos.branchId}
      branchName={pos.branchName ?? pos.branchId}
      ticketTemplate={shell.ticketTemplate}
    />
  );
}

export function BranchesRoute() {
  return <BranchesScreen api={useShell().api} />;
}

export function WaitersRoute() {
  return <WaitersScreen />;
}

export function UsersRoute() {
  return <UsersScreen api={useShell().api} />;
}

export function BillingRoute() {
  const shell = useShell();
  return <BillingScreen api={shell.api} session={shell.session} />;
}

export function QrMenuRoute() {
  return <QRMenuScreen api={useShell().api} />;
}

export function PlatformRoute() {
  return <PlatformScreen api={useShell().api} />;
}
