# Architecture Analysis

Fecha de analisis: 2026-05-09
Actualizacion aplicada: 2026-05-16

## Alcance

Analisis estatico del monorepo `pos-dian`. No se modifico codigo de aplicacion ni se ejecutaron builds. Se revisaron manifests, documentacion existente, rutas API, migraciones, frontend POS, worker DIAN, contratos compartidos, tests y configuracion de infraestructura.

Nota de actualizacion 2026-05-16: despues de este analisis se aplicaron cambios acotados sobre DIAN credit notes, provider HTTP, validacion de sucursal en inventario, contratos compartidos y documentacion. Las secciones de estado fiscal reflejan esa actualizacion.

## Resumen Ejecutivo

El monorepo implementa un POS multi-tenant para Colombia con tres runtimes principales:

- `apps/api`: Fastify + Kysely + PostgreSQL. Expone auth, caja, catalogo, ventas, clientes, inventario, reportes y configuracion fiscal/comercial.
- `apps/worker`: BullMQ + Redis + PostgreSQL. Procesa eventos de outbox para emision DIAN y anulaciones.
- `apps/pos-web`: React + Vite + PWA. Opera caja, ventas, historial, catalogo, clientes, inventario, reportes y sincronizacion offline.
- `packages/shared`: Zod schemas, tipos y constantes compartidas.

La arquitectura base es razonable: venta transaccional en PostgreSQL, emision DIAN desacoplada por outbox, UI offline-friendly, contratos compartidos y tests por dominio. El riesgo principal no es la eleccion tecnologica, sino la concentracion de comportamiento critico en pocos archivos y una deriva entre intencion documentada y comportamiento real en el flujo de notas credito DIAN.

## Topologia del Monorepo

| Area | Responsabilidad | Runtime | Dependencias criticas |
|---|---|---:|---|
| `apps/api` | API REST, reglas de venta, caja, inventario, auditoria | Node 20, Fastify | PostgreSQL, Redis, JWT, Zod, Kysely |
| `apps/worker` | Scheduler outbox, jobs DIAN, provider mock/http | Node 20, BullMQ | PostgreSQL, Redis, provider DIAN |
| `apps/pos-web` | POS web/PWA, cola offline, impresion ticket | Browser, React/Vite | API, IndexedDB, localStorage, Service Worker |
| `packages/shared` | Contratos Zod/TS y constantes | Build/shared lib | Zod |
| `infra` | PostgreSQL, Redis local | Docker Compose | Volumenes persistentes |

## Bounded Contexts Identificados

### 1. Identidad, tenant y RBAC

- Backend: `apps/api/src/routes/auth.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/admin-users.ts`.
- Datos: `users`, `tenants`.
- Contratos: `packages/shared/src/schemas/auth.ts`.
- Reglas:
  - Roles actuales: `ADMIN`, `CASHIER`.
  - JWT incluye `userId`, `tenantId`, `role`, `email`, `name`.
  - Login busca por email activo sin selector de tenant. En la practica esto convierte el email en identificador global aunque la DB solo lo restringe por tenant.

### 2. Perfil comercial y fiscal del tenant

- Backend: `apps/api/src/routes/admin-tenants.ts`.
- Datos: `tenants.tax_mode`, `business_name`, `nit`, `address`, `phone`, `footer_message`.
- Frontend: `DianConfigModal`, `TicketTemplateModal`, `useTenantTaxMode`, `useTicketTemplate`.
- Reglas:
  - `tax_mode` soporta `IVA` e `INC_RESTAURANT`.
  - El backend usa el modo fiscal persistido, no el enviado por el frontend.

### 3. Sucursales y caja

- Backend: `branches.ts`, `cash-sessions.ts`, `cash-sessions-service.ts`.
- Datos: `branches`, `cash_sessions`.
- Frontend: `BranchSetupScreen`, `CloseCashSessionModal`, `useBranchCashSession`, `usePosContextState`.
- Reglas:
  - Una caja abierta por `tenant_id + branch_id`.
  - Cierre calcula efectivo esperado desde ventas `COMPLETED`.

### 4. Catalogo de productos y alcance por sucursal

- Backend: `routes/products.ts`, `modules/products/scope.ts`.
- Datos: `products`.
- Frontend: `ProductsScreen`, catalogo precargado en `PosScreen`.
- Reglas:
  - Producto global con `branch_id = null`, o especifico por sucursal.
  - `tax_category` vive en DB y manda el calculo fiscal de venta.

### 5. Ventas, pagos e idempotencia

- Backend: `routes/sales.ts`, `modules/sales/payments.ts`, `sale-numbering-service.ts`.
- Datos: `sales`, `sale_items`, `dian_documents`, `outbox_events`, `inventory_*`, `audit_logs`.
- Frontend: `PosScreen`, `CheckoutModal`.
- Reglas:
  - `client_uuid` evita duplicados de reintento/offline.
  - Consecutivo `sale_number` por `tenant_id + branch_id`.
  - Backend recalcula totales fiscales y valida suma de pagos.

### 6. Fiscal DIAN y outbox

- API: inserta `dian_documents` y `outbox_events`.
- Worker: `outbox-events.scheduler.ts`, `outbox-sale-created.processor.ts`, `outbox-sale-voided.processor.ts`, `dian-document-status.ts`, providers.
- Datos: `dian_documents`, `outbox_events`.
- Reglas:
  - Factura: `SALE_CREATED`.
  - Anulacion: `SALE_VOIDED`.
  - Provider actual: `mock` o `http`.

### 7. Offline/sync POS

- Frontend: `offline-queue.ts`, `usePendingSalesSync.ts`, `PosScreen`.
- Datos locales: IndexedDB `pos-dian-offline`, object store `pending-sales`.
- Reglas:
  - Solo se encola cuando falla por red, `408`, `429` o `5xx`.
  - Reintenta secuencialmente y conserva el mismo `client_uuid`.
  - Se detiene ante red caida o `401`.

### 8. Inventario

- Backend: `routes/inventory.ts`.
- Datos: `inventory_balances`, `inventory_transactions`.
- Frontend: `InventoryScreen`.
- Reglas:
  - Venta descuenta inventario.
  - Anulacion repone inventario.
  - Ajustes manuales por `ADMIN`.

### 9. Clientes/terceros

- Backend: `routes/customers.ts`.
- Datos: `customers`, `sales.customer_id`.
- Frontend: `CustomersScreen`, selector en `CheckoutModal`.
- Reglas:
  - Unico por `tenant_id + document_type + document_number`.
  - `ADMIN` y `CASHIER` pueden crear/editar clientes.

### 10. Reportes

- Backend: `routes/reports.ts`.
- Frontend: `ReportsScreen`.
- Regla:
  - Reporta ventas `COMPLETED` por sucursal y periodo.

## Flujo de Venta Actual

1. `pos-web` autentica al usuario con `POST /auth/login`.
2. `SessionProvider` guarda token y usuario en `localStorage`.
3. `BranchSetupScreen` lista sucursales y detecta caja abierta.
4. Si no hay caja abierta, llama `POST /cash-sessions/open`.
5. `PosScreen` carga hasta 5000 productos activos y clientes.
6. El cajero arma carrito local y abre `CheckoutModal`.
7. El checkout genera `CreateSaleRequest` con:
   - `client_uuid`
   - `customer_id`
   - `branch_id`
   - `cash_session_id`
   - `discount_cents`
   - `items`
   - `payments`
8. `POST /sales` valida idempotencia por `tenant_id + client_uuid`.
9. Dentro de transaccion:
   - bloquea la caja (`cash_sessions FOR UPDATE`);
   - carga `tenant.tax_mode`;
   - carga productos en scope de sucursal;
   - usa `products.tax_category`;
   - calcula impuestos;
   - normaliza pagos;
   - bloquea la sucursal para calcular `sale_number`;
   - inserta `sales` y `sale_items`;
   - descuenta inventario;
   - inserta `dian_documents PENDING`;
   - inserta `outbox_events SALE_CREATED`;
   - escribe auditoria.
10. El frontend limpia carrito, muestra estado DIAN inicial e imprime/reimprime ticket.
11. Si el error califica como offline/transitorio, guarda la venta en IndexedDB.

## Flujo Fiscal DIAN Actual

### Factura electronica

1. API crea `dian_documents.status = PENDING`.
2. API crea `outbox_events.type = SALE_CREATED`.
3. Worker scheduler busca outbox `PENDING` o `FAILED` vencidos.
4. Scheduler encola BullMQ con job id `outbox:<event_id>`.
5. Processor reclama el outbox actualizando `next_retry_at`.
6. Processor obtiene o crea `dian_document`.
7. Si el documento ya tiene CUDE o estado final, marca outbox como `SENT` y omite.
8. Processor reconstruye payload DIAN desde DB.
9. Provider `mock` o `http` emite.
10. `planDianStatusTransition` aplica transiciones:
    - `PENDING -> SENT -> ACCEPTED` si provider devuelve `ACCEPTED`.
    - `PENDING -> SENT` si provider devuelve `SENT`.
    - `PENDING -> REJECTED` si provider devuelve `REJECTED`.
11. Worker actualiza `dian_documents` y marca outbox `SENT`.
12. Si falla provider, actualiza metadata de error, marca outbox `FAILED` y calcula backoff.

### Anulacion y nota credito

1. API `POST /sales/:id/void` cambia venta a `VOID`.
2. Repone inventario.
3. Audita `SALE_VOIDED`.
4. Si existe factura `dian_documents.document_type = INVOICE`, crea outbox `SALE_VOIDED`.
5. Worker solo intenta nota credito si la factura original esta `ACCEPTED`.
6. Worker crea o reutiliza una fila separada `dian_documents.document_type = CREDIT_NOTE`.
7. La nota credito guarda `parent_document_id` apuntando a la factura original.
8. Construye payload con `document_type = CREDIT_NOTE`.
9. La transicion fiscal se aplica sobre la nota credito desde `PENDING`, no sobre la factura aceptada.

Estado 2026-05-16: el riesgo `ACCEPTED -> ACCEPTED` quedo corregido con migracion aditiva `009_dian_document_types`.

## Pipeline Offline/Sync

El offline actual es robusto para reintentos de venta, pero no es offline completo de catalogo persistente.

### Lo que existe

- PWA cachea assets estaticos via Workbox.
- `PosScreen` precarga productos en memoria.
- `offline-queue.ts` guarda ventas pendientes en IndexedDB.
- La llave local es el `client_uuid`.
- `usePendingSalesSync` sincroniza al volver online o manualmente.
- La API responde `200` con venta existente si `client_uuid` ya fue registrado.

### Limites actuales

- El catalogo de productos no se persiste en IndexedDB. Si se recarga la pagina offline, no hay garantia de catalogo disponible.
- La cola no usa Background Sync del service worker; depende de la app abierta.
- La sesion en `localStorage` expirada bloquea sync hasta login.
- El payload offline conserva precios del momento del checkout y el backend acepta `price_cents` del cliente si viene presente.

## Dependencias Criticas

| Dependencia | Uso | Riesgo operativo |
|---|---|---|
| PostgreSQL | Fuente de verdad para ventas, inventario, outbox, usuarios | Caida detiene API y worker |
| Redis/BullMQ | Transporte de jobs DIAN | Sin Redis el outbox queda duradero pero no se procesa |
| Provider DIAN HTTP | Emision fiscal real | Timeout, rechazo, payload incompatible |
| `@pos-dian/shared` | Contratos API/web/worker | Drift de tipos rompe integracion silenciosamente |
| IndexedDB | Cola offline local | Datos locales por browser/dispositivo |
| localStorage | JWT, contexto POS, plantilla ticket | Riesgo XSS y sesion obsoleta |
| Kysely + migraciones | Tipado DB en API | Worker usa SQL raw y duplica conocimiento |
| PWA Workbox | Cache estatico | No cubre datos dinamicos del POS |

## Observaciones Arquitectonicas Clave

- La arquitectura declarada y la implementada coinciden en el flujo principal de venta.
- El outbox transaccional esta bien ubicado en API, pero `apps/api` aun crea una `dianQueue` BullMQ que ya no parece usada por `routes/sales.ts`.
- La frontera API/worker es la DB, no un contrato de eventos tipado. El worker interpreta `outbox_events.payload_json` y reconstruye con SQL raw.
- `packages/shared` mezcla schemas fuente con tipos manuales en `types/domain.ts`; esos tipos ya muestran drift.
- La emision DIAN y la anulacion comparten demasiado codigo duplicado; el documento fiscal por tipo ya quedo modelado para `INVOICE` y `CREDIT_NOTE`.
- El frontend esta organizado por features, pero varias pantallas ya son componentes monoliticos con estado, UI, side effects y reglas juntos.

## Conclusiones

La base permite evolucion incremental sin reestructurar todo. La prioridad debe ser reducir riesgo en los flujos mas criticos:

1. Extraer servicios internos de venta sin cambiar endpoints.
2. Consolidar builder/normalizadores del worker.
3. Resolver finalizacion de documentos DIAN en `SENT`.
4. Definir politica de override de precio desde cliente.
5. Persistir o documentar mejor los limites offline.
