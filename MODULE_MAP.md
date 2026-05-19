# Module Map

Fecha de analisis: 2026-05-09
Actualizacion aplicada: 2026-05-16

## Metricas Aproximadas

Conteo estatico excluyendo `node_modules`, `dist`, `build`, `.git` y `.turbo`.

| Area | Archivos TS/TSX | LOC aprox. | Perfil |
|---|---:|---:|---|
| `apps/api` | 67 | 8526 | Backend principal y tests |
| `apps/pos-web` | 71 | 7990 | Frontend POS, hooks, tests |
| `apps/worker` | 22 | 3433 | Jobs DIAN, scheduler, tests |
| `packages/shared` | 17 | 1131 | Contratos Zod/TS |
| Total fuente | 177 | 21080 | Monorepo pequeno/medio |

Hay 34 archivos de test detectados. El area con mayor complejidad acumulada sigue siendo ventas + worker DIAN.

## Mapa de Apps y Paquetes

### Root

| Archivo | Rol |
|---|---|
| `package.json` | Scripts turbo: `dev`, `lint`, `test`, `build` |
| `pnpm-workspace.yaml` | Workspaces `apps/*`, `packages/*` |
| `turbo.json` | Pipeline build/lint/test/dev |
| `tsconfig.json` | Alias `@pos-dian/shared` hacia `packages/shared/src` |
| `.github/workflows/ci.yml` | CI con install, lint, test, build |

### `apps/api`

| Modulo | Archivos principales | Responsabilidad |
|---|---|---|
| App bootstrap | `src/index.ts`, `src/app/build-app.ts`, `src/app/env.ts`, `src/app/cors.ts` | Construccion Fastify, CORS, DB, plugins, rutas |
| Auth/RBAC | `src/routes/auth.ts`, `src/plugins/auth.ts`, `src/auth/*`, `src/infra/security/login-rate-limit.ts` | Login, JWT, roles, rate limit |
| Tenants/admin | `src/routes/admin-tenants.ts`, `src/routes/admin-users.ts` | Perfil fiscal/comercial y usuarios |
| Branches/caja | `src/routes/branches.ts`, `src/routes/cash-sessions.ts`, `src/domain/cash-sessions-service.ts` | Sucursales, apertura/cierre caja, arqueo |
| Catalogo | `src/routes/products.ts`, `src/modules/products/*` | CRUD productos, scope por sucursal, categoria fiscal |
| Ventas | `src/routes/sales.ts`, `src/modules/sales/payments.ts`, `src/domain/sale-numbering-service.ts`, `src/domain/tax` | Checkout, idempotencia, impuestos, inventario, outbox, anulacion |
| Clientes | `src/routes/customers.ts` | Terceros para venta |
| Inventario | `src/routes/inventory.ts` | Saldos y transacciones manuales |
| Reportes | `src/routes/reports.ts` | KPIs de ventas por sucursal |
| Auditoria | `src/domain/audit/write-audit-log.ts` | Insercion de eventos auditables |
| DB | `src/infra/db/*` | Conexion, migraciones, seed, schema Kysely |
| Queue legacy/infra | `src/infra/queue/dian-queue.ts` | Cola BullMQ DIAN, actualmente no usada por `routes/sales.ts` |

### `apps/worker`

| Modulo | Archivos principales | Responsabilidad |
|---|---|---|
| Runtime | `src/index.ts` | Worker BullMQ, scheduler, health server, shutdown |
| Scheduler | `src/scheduler/outbox-events.scheduler.ts` | Lee outbox vencidos y encola jobs |
| Factura | `src/jobs/outbox-sale-created.processor.ts` | Emite factura por `SALE_CREATED` |
| Anulacion | `src/jobs/outbox-sale-voided.processor.ts` | Emite nota credito `CREDIT_NOTE` separada por `SALE_VOIDED` |
| Estado DIAN | `src/domain/dian-document-status.ts` | Maquina de estados permitida |
| Provider | `src/providers/*` | Mock y HTTP generic |
| Retry | `src/outbox/backoff.ts` | Backoff exponencial |
| Infra | `src/config/env.ts`, `src/infra/db/pool.ts`, `src/infra/logging/worker-log.ts` | Env, PG pool, logs |

### `apps/pos-web`

| Modulo | Archivos principales | Responsabilidad |
|---|---|---|
| Shell | `src/app/App.tsx`, `src/app/routes.ts`, `src/components/layout/*` | Composicion de sesion, ruta activa, topbar, modales |
| Auth | `src/features/auth/*`, `src/lib/session/*` | Login, guards, session local |
| Caja | `src/features/branches/BranchSetupScreen.tsx`, `src/features/cash-sessions/*` | Seleccion sucursal y apertura/cierre |
| Venta POS | `src/features/sales/PosScreen.tsx`, `CheckoutModal.tsx`, `utils.ts` | Catalogo, carrito, checkout, ticket, cola offline |
| Historial | `src/features/history/HistoryScreen.tsx` | Listado, detalle, reimpresion, anulacion |
| Catalogo | `src/features/products/ProductsScreen.tsx`, `constants.ts` | CRUD productos |
| Clientes | `src/features/customers/CustomersScreen.tsx` | Directorio terceros |
| Inventario | `src/features/inventory/InventoryScreen.tsx` | Saldos y ajustes |
| Reportes | `src/features/reports/ReportsScreen.tsx` | Dashboard de ventas |
| API client | `src/lib/api/client.ts` | Cliente fetch tipado |
| Offline | `src/lib/offline-queue.ts`, `src/hooks/usePendingSalesSync.ts` | IndexedDB y sync |
| Ticket | `src/lib/ticket-printer.ts`, `src/lib/ticket-template.ts`, `useTicketTemplate.ts` | Impresion HTML y plantilla local |

### `packages/shared`

| Modulo | Archivos principales | Responsabilidad |
|---|---|---|
| Schemas | `src/schemas/*.ts` | Contratos Zod de auth, producto, venta, cliente, inventario, reportes, tenant |
| Provider DIAN | `src/types/dian-provider.ts`, `src/schemas/dian-provider.ts` | Payload provider fiscal |
| Constantes | `src/constants/queues.ts` | Nombre cola BullMQ |
| Export barrel | `src/index.ts` | API publica del paquete |
| Tipos manuales | `src/types/domain.ts` | Tipos duplicados; drift principal de `customer_id` ya alineado, sigue siendo candidato a deprecacion |

## Superficie API Principal

| Contexto | Endpoint | Metodo | Roles |
|---|---|---|---|
| Auth | `/api/v1/auth/login` | POST | Publico |
| Auth | `/api/v1/auth/me` | GET | Auth |
| Sucursales | `/api/v1/branches` | GET | `ADMIN`, `CASHIER` |
| Caja | `/api/v1/cash-sessions/open` | POST | `ADMIN`, `CASHIER` |
| Caja | `/api/v1/cash-sessions/:id/close` | POST | `ADMIN`, `CASHIER` |
| Caja | `/api/v1/cash-sessions/current` | GET | `ADMIN`, `CASHIER` |
| Productos | `/api/v1/products` | GET | `ADMIN`, `CASHIER` |
| Productos | `/api/v1/products` | POST | `ADMIN` |
| Productos | `/api/v1/products/:id` | PATCH | `ADMIN` |
| Productos | `/api/v1/products/:id/toggle-active` | POST | `ADMIN` |
| Ventas | `/api/v1/sales` | POST | `ADMIN`, `CASHIER` |
| Ventas | `/api/v1/sales` | GET | `ADMIN`, `CASHIER` |
| Ventas | `/api/v1/sales/:id` | GET | `ADMIN`, `CASHIER` |
| Ventas | `/api/v1/sales/:id/void` | POST | `ADMIN` |
| Tenant | `/api/v1/admin/tenants/current` | GET | Auth |
| Tenant | `/api/v1/admin/tenants/current` | PATCH | `ADMIN` |
| Fiscal | `/api/v1/admin/tenants/:id/tax-profile` | PATCH | `ADMIN` |
| Usuarios | `/api/v1/admin/users` | GET/POST | `ADMIN` |
| Clientes | `/api/v1/customers` | GET/POST | `ADMIN`, `CASHIER` |
| Clientes | `/api/v1/customers/:id` | PATCH | `ADMIN`, `CASHIER` |
| Inventario | `/api/v1/inventory/balances` | GET | `ADMIN`, `CASHIER` |
| Inventario | `/api/v1/inventory/transactions` | POST | `ADMIN` |
| Reportes | `/api/v1/reports/sales` | GET | `ADMIN` |

## Modelo de Datos

| Tabla | Contexto | Notas |
|---|---|---|
| `tenants` | Tenant/fiscal | `tax_mode`, NIT, perfil comercial |
| `branches` | Sucursal | Scope operativo |
| `users` | Auth/RBAC | Email unico por tenant, login sin selector de tenant |
| `products` | Catalogo | Producto global o por sucursal, `tax_category` |
| `customers` | Clientes | Terceros por documento |
| `cash_sessions` | Caja | Una abierta por sucursal |
| `sales` | Ventas | `client_uuid`, consecutivo, totales, metadata VOID |
| `sale_items` | Ventas | Lineas con qty decimal |
| `dian_documents` | Fiscal | Una fila por venta y tipo fiscal: `INVOICE` o `CREDIT_NOTE` |
| `outbox_events` | Integracion | Eventos `SALE_CREATED`, `SALE_VOIDED` |
| `audit_logs` | Auditoria | Eventos operativos |
| `inventory_balances` | Inventario | Saldo por tenant/sucursal/producto |
| `inventory_transactions` | Inventario | Kardex simple |

## Archivos Criticos

| Archivo | Criticidad | Motivo |
|---|---:|---|
| `apps/api/src/routes/sales.ts` | Alta | Transaccion de venta, impuestos, inventario, outbox y anulacion |
| `apps/api/src/domain/tax/index.ts` | Alta | Calculo fiscal por centavo |
| `apps/api/src/domain/sale-numbering-service.ts` | Alta | Consecutivo por sucursal con lock |
| `apps/worker/src/jobs/outbox-sale-created.processor.ts` | Alta | Emision factura DIAN |
| `apps/worker/src/jobs/outbox-sale-voided.processor.ts` | Alta | Nota credito/anulacion DIAN |
| `apps/worker/src/domain/dian-document-status.ts` | Alta | Maquina de estados DIAN |
| `apps/pos-web/src/features/sales/PosScreen.tsx` | Alta | Operacion POS diaria |
| `apps/pos-web/src/lib/offline-queue.ts` | Alta | Persistencia offline local |
| `apps/pos-web/src/hooks/usePendingSalesSync.ts` | Alta | Reintentos offline |
| `packages/shared/src/schemas/sale.ts` | Alta | Contrato venta API/web |
| `apps/api/src/infra/db/migrations/*` | Alta | Modelo persistente |
| `apps/api/src/plugins/auth.ts` | Media/Alta | Tenant y roles en request |

## Archivos Monoliticos

| Archivo | LOC aprox. | Complejidad heuristica | Comentario |
|---|---:|---:|---|
| `apps/api/src/routes/sales.ts` | 877 | 59 | Demasiadas responsabilidades en una ruta |
| `apps/pos-web/src/features/sales/PosScreen.tsx` | 818 | 114 | Estado, UI, carrito, catalogo, offline, ticket |
| `apps/worker/src/jobs/outbox-sale-created.processor.ts` | 648 | 83 | Payload DIAN, SQL, transicion, retry |
| `apps/worker/src/jobs/outbox-sale-voided.processor.ts` | 712 | 88 | Casi duplicado del processor de factura, ahora con modelo de nota credito separado |
| `apps/pos-web/src/features/history/HistoryScreen.tsx` | 557 | 70 | Lista, detalle, anulacion, ticket |
| `apps/pos-web/src/features/sales/components/CheckoutModal.tsx` | 489 | 50 | Pagos simples/mixtos y cliente |
| `apps/pos-web/src/lib/ticket-printer.ts` | 482 | 34 | Builder HTML/CSS e impresion |
| `apps/api/src/routes/products.ts` | 436 | 27 | CRUD + scope + auditoria |
| `apps/pos-web/src/features/products/ProductsScreen.tsx` | 403 | 41 | UI y formulario en un archivo |

## Modulos Candidatos a Extraccion

| Origen | Candidato | Objetivo |
|---|---|---|
| `routes/sales.ts` | `sales/create-sale-service.ts` | Aislar transaccion de creacion |
| `routes/sales.ts` | `sales/void-sale-service.ts` | Aislar anulacion e inventario inverso |
| `routes/sales.ts` | `sales/inventory-mutations.ts` | Reusar descuento/reposicion |
| `routes/sales.ts` | `sales/sale-mapper.ts` | Centralizar mapping DB -> API |
| Worker processors | `jobs/dian-payload-builder.ts` | Eliminar duplicacion de payload |
| Worker processors | `jobs/outbox-state-store.ts` | Centralizar claim/mark sent/failed |
| Worker processors | `jobs/payment-normalizer.ts`, `jobs/tax-line-normalizer.ts` | Compartir normalizadores |
| `PosScreen.tsx` | `useProductCatalog`, `useCart`, `useCheckoutSale` | Reducir estado y side effects |
| `HistoryScreen.tsx` | `useSalesHistory`, `SaleDetailPanel`, `VoidSaleModal` | Separar lista/detalle/acciones |
| `ticket-printer.ts` | `ticket-html-builder.ts`, `ticket-window.ts` | Separar HTML de side effect |
| `packages/shared/src/types/domain.ts` | Deprecar o regenerar desde schemas | Evitar drift |
