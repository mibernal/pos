import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RouteGuard } from './RouteGuard';
import { QrTableScreen } from '../features/public-menu/QrTableScreen';
import { PublicMenuScreen } from '../features/public-menu/PublicMenuScreen';
import { useParams } from 'react-router-dom';
import type { AppRoute } from '../types';
import * as pantallas from './route-elements';

/**
 * El árbol de rutas.
 *
 * Cada pantalla tiene su URL, y por eso recargar devuelve donde estabas — que es el criterio
 * de salida de esta fase. Antes la pantalla activa era un `useState` dentro del armazón:
 * recargar te devolvía siempre al POS, y no había forma de mandarle a nadie un enlace a una
 * pantalla concreta.
 */

function QrTableRoute() {
  const { token } = useParams();
  return <QrTableScreen token={token ?? ''} />;
}

function PublicMenuRoute() {
  const { branchId } = useParams();
  return <PublicMenuScreen branchId={branchId ?? ''} />;
}

/** Ruta protegida: identificador, elemento, y la guarda que sale de la definición. */
function protegida(id: AppRoute, elemento: JSX.Element) {
  return <Route key={id} path={id} element={<RouteGuard route={id}>{elemento}</RouteGuard>} />;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* Públicas: el comensal no tiene sesión ni la necesita. */}
      <Route path="/mesa/:token" element={<QrTableRoute />} />
      <Route path="/menu/:branchId" element={<PublicMenuRoute />} />

      <Route path="/" element={<AppShell />}>
        {protegida('pos', <pantallas.PosRoute />)}
        {protegida('history', <pantallas.HistoryRoute />)}
        {protegida('cash-control', <pantallas.CashControlRoute />)}
        {protegida('tables', <pantallas.TablesRoute />)}
        {protegida('kds', <pantallas.KdsRoute />)}
        {protegida('reservations', <pantallas.ReservationsRoute />)}
        {protegida('delivery', <pantallas.DeliveryRoute />)}
        {protegida('products', <pantallas.ProductsRoute />)}
        {protegida('promotions', <pantallas.PromotionsRoute />)}
        {protegida('payment-methods', <pantallas.PaymentMethodsRoute />)}
        {protegida('customers', <pantallas.CustomersRoute />)}
        {protegida('inventory', <pantallas.InventoryRoute />)}
        {protegida('recipes', <pantallas.RecipesRoute />)}
        {protegida('bulk-import', <pantallas.BulkImportRoute />)}
        {protegida('reports', <pantallas.ReportsRoute />)}
        {protegida('branches', <pantallas.BranchesRoute />)}
        {protegida('waiters', <pantallas.WaitersRoute />)}
        {protegida('users', <pantallas.UsersRoute />)}
        {protegida('billing', <pantallas.BillingRoute />)}
        {protegida('qr-menu', <pantallas.QrMenuRoute />)}
        {protegida('platform', <pantallas.PlatformRoute />)}
      </Route>
    </Routes>
  );
}
