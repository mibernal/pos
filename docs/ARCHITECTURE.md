# ARCHITECTURE

> Última actualización: Septiembre 2026 (cierre de la fase 11)

## Objetivo

`pos-dian` es un POS multi-tenant para Colombia, orientado a operación real de caja y cumplimiento DIAN sin meter la emisión fiscal dentro del request de venta. Diseñado bajo los principios de **desacoplamiento asíncrono**, **offline-first** y **observabilidad distribuida** desde el primer día.

---

## Componentes del Sistema

| Componente | Stack | Rol |
|---|---|---|
| `apps/api` | Fastify · TypeScript · Kysely · Zod · OpenTelemetry | Auth, sucursales, caja, catálogo, ventas, configuración fiscal, billing, importaciones masivas, trazas OTLP y backoffice global SaaS |
| `apps/worker` | BullMQ · TypeScript · PostgreSQL | Consumo del outbox, DIAN, importaciones masivas (Enterprise), Schedulers (Limpieza, Alertas, Rollups) |
| `apps/pos-web` | React · Vite · React Router · React Query · Dexie.js · PWA (Workbox) · Playwright | Shell POS offline-first con URL por pantalla, backoffice (Identity, Tenants), Control Center SuperAdmin, historial y configuración |
| `packages/shared` | TypeScript · Zod | Contratos, tipos y esquemas compartidos entre API, worker y web |

---

## Entidades Clave (Modelo de Datos)

- **`tenants` / `tenant_subscriptions` / `billing_plans`**: Gestión multi-tenant y modelo SaaS prepago.
- **`users` / `user_branches`**: RBAC (PlatformOwner, TenantOwner, Admin, Cashier, Manager).
- **`inventory_balances` / `inventory_ledger` / `inventory_adjustments`**: Fuerte consistencia de inventario (Optimistic Locking & Ledger inmutable).
- **`sales` / `sale_items` / `sales_ledger`**: Venta operativa con protección por idempotencia (`client_uuid`).
- **`deliveries` / `delivery_items` / `delivery_persons`**: Módulo de domicilios con seguimiento de estados (Pending, En Camino, etc.) y facturación asíncrona.
- **`rooms` / `tables` / `table_orders` / `table_order_items`**: Módulo de gestión de mesas y pedidos presenciales (sincronizados con backend para control centralizado de cuentas).
- **`product_recipes` / `recipe_components`**: Escandallo. De qué está hecho un plato, con recetas anidadas. Es lo que convierte lo vendido en lo consumido antes de tocar el inventario (D-064).
- **`waiter_shifts`**: Turnos de mesero (apertura, cierre, mesas asignadas). El corte se deduce del tiempo y se congela en `summary_json` al cerrar; no hay columna de turno en `sales` (D-065).
- **`qr_table_tokens`**: Credencial de la mesa para el pedido desde el menú QR. Sin RLS y sin más contenido que identificadores, porque resuelve a qué comercio pertenece la petición *antes* de que exista contexto de tenant (D-066).
- **`payment_transactions`**: Transacciones de pago y webhooks de pasarelas (Wompi, MercadoPago).
- **`bulk_import_jobs`**: Control de cargas masivas de catálogo procesadas en background.
- **`idempotency_records`**: Tracking de peticiones seguras (ej. creación de ventas) con TTL de 24h.
- **`dian_documents` / `outbox_events`**: Orquestación asíncrona de facturación electrónica.
- **`dian_resolutions`**: Resoluciones de facturación autorizadas por la DIAN (prefijo, rango, vigencia, consecutivo). Es de donde sale el número de cada factura electrónica.

---

## Flujos de Sistema

### 1. Flujo POS Completo

```
pos-web → POST /auth/login
→ SessionProvider persiste token + restaura en recarga + invalida en 401
→ Seleccionar sucursal → POST /cash-sessions/open
→ Cargar catálogo (Dexie TTL 12h → API → Dexie fallback offline)
→ Búsqueda por nombre, código de barras o QTY*BARCODE
→ Checkout: CreateSaleInput { Idempotency-Key header, client_uuid, branch_id, cash_session_id, items, payments }
→ POST /sales → API intercepta Idempotencia, usa Bloqueo Pesimista (FOR UPDATE) en inventario, calcula fiscal, guarda venta + ledger + outbox
→ Si falla por red → IndexedDB offline queue → sincroniza al reconectar
→ Historial → reimpresión → anulación (ADMIN)
```

### 2. Flujo Fiscal Colombia

- Todos los montos en `*_cents` (centavos de COP).
- El POS trabaja con **precio final al consumidor**; los impuestos nunca se calculan en el frontend.
- `tenants.tax_mode` define el modo fiscal del negocio: `IVA` o `INC_RESTAURANT`.
- `products.tax_category` por producto: `IVA_19`, `IVA_5`, `IVA_0`, `EXEMPT`, `EXCLUDED`, `INC_8`.
- La API resuelve y persiste: `subtotal_cents`, `discount_cents`, `tax_total_cents`, `tax_lines_json`, `total_cents`.
- El ticket muestra texto contextual: `Incluye IVA` o `Incluye INC`.

### 2.b Numeración fiscal (resoluciones DIAN)

La DIAN autoriza una **resolución** con prefijo, rango numérico y vigencia. Cada documento electrónico lleva un número de ese rango y el CUFE/CUDE se calcula sobre él. `sales.sale_number` es el contador interno del comercio y **no** sirve como número de factura.

```
Admin carga la resolución  →  dian_resolutions (prefijo, rango, vigencia, current_number)
Worker va a emitir         →  assignDocumentNumber() reserva el siguiente consecutivo
                              (UPDATE ... RETURNING = lock de fila hasta el commit)
                           →  se persiste en dian_documents (resolution_id, prefix, document_number)
                           →  se envía al PAC dentro de `numbering`
Reintento                  →  reutiliza el número persistido, no consume otro
Rollback de la emisión     →  el número vuelve al rango (no es una secuencia)
```

Puntos que conviene no perder de vista:

- El número se asigna **al emitir**, no al crear la venta: una venta anulada antes de que el worker la procese no quema un consecutivo, y un hueco hay que justificarlo ante la DIAN.
- La reserva **no** usa una secuencia de Postgres a propósito: las secuencias no retroceden en un rollback.
- `uq_dian_documents_fiscal_number` impide dos documentos con el mismo número dentro de un comercio.
- Un índice único parcial garantiza **una sola resolución activa** por comercio, tipo de documento y sucursal: dos activas producirían dos series de numeración en paralelo.
- Alertas antes del problema: `dian_resolution.alert` cuando el rango baja de `alert_threshold` o faltan 30 días para vencer.

### 2.c Cierre del ciclo: documentos en `SENT`

La emisión es asíncrona; el PAC acusa recibo y resuelve después. Dos vías que se cubren mutuamente:

- **Consulta** (`queryStatus`, cada ~5 min): siempre funciona. `UNKNOWN` deja el documento como está — es «no sé decírtelo ahora», no un rechazo.
- **Webhook** (`POST /api/v1/webhooks/dian/:tenantId/status`): inmediato pero puede perderse. HMAC-SHA256 sobre el cuerpo crudo. El comercio va en la ruta porque una petición del PAC no trae sesión y la API corre sin `BYPASSRLS`.
- **Alerta** `dian_document.unresolved` pasadas `DIAN_SENT_ALERT_HOURS`.

El scheduler **no reemite**: reemitir un documento ya enviado podría hacer que el PAC lo acepte dos veces (D-060).

### 3. Flujo DIAN con Worker (Transactional Outbox)

```
1. API inserta venta + dian_documents (INVOICE, PENDING) + outbox SALE_CREATED (transacción atómica)
2. Scheduler del worker → jobs BullMQ por outbox pendiente
3. outbox-sale-created.processor: carga venta, items, tenant, sucursal
4. Construye payload fiscal: taxMode, taxTotalCents, taxLines, items, pagos, datos negocio
5. Provider DIAN devuelve resultado
6. Worker aplica transiciones centralizadas:
   PENDING → SENT | SENT → ACCEPTED | SENT → REJECTED | PENDING → REJECTED
7. Transiciones inválidas se rechazan. Documentos ACCEPTED + CUDE no se reemiten.
8. Si el provider falla → outbox pasa a retry con backoff exponencial
```

### 4. Anulación Fiscal y Nota Crédito

```
POST /sales/:id/void (solo ADMIN, requiere motivo)
→ Venta → VOID, persiste void_reason, voided_by_user_id, voided_at
→ Repone inventario atómicamente
→ Audita SALE_VOIDED
→ Si existe factura INVOICE → crea outbox SALE_VOIDED
→ Worker espera hasta que INVOICE esté ACCEPTED
→ Crea o reutiliza dian_documents CREDIT_NOTE con parent_document_id
→ CREDIT_NOTE inicia su propia máquina de estados desde PENDING
→ GET /sales/:id mantiene compatibilidad exponiendo dian_document como la factura principal
```

### 5. Flujo Offline y Sincronización

```
1. Cada venta crea client_uuid = crypto.randomUUID() en el frontend
2. POST /sales falla por red → addPendingSale(payload) → IndexedDB (pos-dian-offline)
3. POS muestra contador de ventas pendientes
4. window 'online' event → syncPendingSales() automático
5. flushPendingSales: lotes de 5, MAX_SYNC_ATTEMPTS = 5
6. Si backend responde 409 (client_uuid ya existe) → venta se da por sincronizada (idempotencia)
7. Si backend responde 401 → sincronización se detiene; espera re-login
8. Si sync_attempts >= 5 → estado ABORTED, visible para el cajero con opción de reintentar

### 6. Carga Masiva (Enterprise Bulk Import)

```
1. Usuario sube CSV/Excel (hasta 50,000 productos)
2. API (multipart) procesa en chunks stream-based y encola job en BullMQ (`bulk-import-queue`)
3. Worker procesa por chunks (batching), validando SKUs, tipos, y previniendo duplicados
4. Se maneja `processed_rows`, `valid_rows` y estado completado
5. Interfaz actualiza barra de progreso sin bloquear uso del POS
```

### 7. SaaS Billing & Subscriptions

```
1. API expone `/api/v1/billing/checkout` → redirección a Pasarela (Wompi/MercadoPago)
2. Usuario completa pago → Redirección a la App
3. Webhook asíncrono `/api/v1/webhooks/:gateway`
4. Validación de firma criptográfica
5. Actualización atómica de `payment_transactions` y `tenants.plan`
```

### 8. Flujo de Domicilios (Delivery Module)

```
1. Cajero o Toma-pedidos crea un domicilio con datos del cliente y productos.
2. Estado inicial: PENDING.
3. Cocina toma el pedido → PREPARATION.
4. Se asigna repartidor (DeliveryPerson) → ON_WAY.
5. Repartidor entrega → DELIVERED.
6. POST /branches/:branchId/deliveries/:id/invoice (turno de caja + medios de pago)
   → crea la venta → outbox SALE_CREATED → documento fiscal.
```

**La facturación es un paso explícito, no automática al marcar ENTREGADO** (D-062): una venta necesita turno de caja y medio de pago, y ninguno se puede adivinar — el repartidor pudo cobrar en efectivo, con datáfono, o el cliente pudo pagar por adelantado. La idempotencia usa un `client_uuid` determinista derivado del id del domicilio, de modo que un doble clic devuelve la misma venta.

Hasta la fase 4 este flujo terminaba en el paso 5: nada creaba la venta, así que el pedido se cobraba y **no se facturaba**.

---

## Arquitectura de la aplicación web (`pos-web`)

Hasta la fase 11 la aplicación no tenía enrutador —`App.tsx` resolvía la pantalla con un `if/else` de 381 líneas— y el backend se llamaba de dos maneras a la vez. Hoy la estructura son tres piezas y cada una tiene una sola forma de usarse.

### Enrutado: la definición de la ruta es su guarda

`AppShell` monta el armazón, `AppRoutes` declara las rutas con carga diferida por ruta, y `RouteGuard` decide quién entra. La URL de una pantalla es su identificador (`pathForRoute` es `/${id}`, sin tabla de traducción), de modo que **recargar cualquier pantalla la devuelve donde estaba** — en una tablet de salón, eso es la diferencia entre seguir con el pedido y perderlo.

Lo importante es dónde vive la guarda: en `routes.ts`, junto a la definición, y de ahí la leen tanto el menú (`usePosNavigation`) como la entrada por URL. Antes estaba escrita dos veces y las dos copias habían divergido — el menú escondía el KDS a quien no tuviera `kitchen_display` mientras la pantalla solo exigía `kitchen`. `routeAccess` devuelve el motivo (`missing-module` / `missing-permission`) y no un booleano, porque a quien llega por un enlace guardado le falta o el permiso o el plan, y son cosas que se arreglan en sitios distintos.

`PLATFORM_OWNER` solo ve la pantalla de plataforma y nadie más la ve. `ADMIN` y `TENANT_OWNER` ven todo lo de su comercio: los permisos por rol acotan al personal, no a quien contrata el servicio.

### Estado del servidor: React Query, con las claves en un solo sitio

El cliente del API dejó de pasarse como prop; se obtiene con `useApi()` y las 34 pantallas consultan con React Query. Después de escribir ya no se vuelve a llamar al cargador a mano: se invalida.

Las claves de los dieciséis dominios salen de la fábrica `shared/query-keys`, con el ámbito primero (`tenant`, `branch`, `platform`, `public`). No es estética: permite invalidar una sucursal entera en una línea y evita que cambiar de comercio deje migas del anterior. Una clave es un contrato entre quien consulta y quien invalida, y escrita a mano en dos archivos distintos se puede escribir mal en uno solo sin que se note leyendo cualquiera de los dos — es lo que pasaba con la invalidación del KDS, que apuntaba a una clave que no consultaba nadie (D-069).

### El contrato con la API

La API publica su OpenAPI de verdad desde la fase 11 (`registerSwagger` va envuelto en `fastify-plugin`; sin eso `/docs` documentaba cero rutas). De ahí se generan `openapi.json` y `apps/pos-web/src/lib/api/schema.d.ts`, y CI falla si el contrato cambió y no se regeneraron:

```bash
pnpm --filter @pos-dian/api openapi:dump
pnpm --filter @pos-dian/pos-web api-types
```

Las rutas declaran `response` en su esquema —cinco del camino del dinero por ahora, y una prueba con candado lleva la cuenta de las que faltan (D-070)—. Conviene saber que declararla no es documentar: Fastify serializa a través del esquema y recorta lo que no esté en él.

**Lo que falta para cerrar el círculo:** `contract.ts` (los tipos generados) no lo importa todavía ningún archivo y `client.ts` mantiene 38 tipos escritos a mano, así que añadir un endpoint sigue costando tipos manuales. Trece archivos siguen llamando con `fetch` crudo: SSE y pantallas públicas, en dos estilos distintos.

### Pruebas de navegador

`apps/pos-web/e2e/` con Playwright, en CI y bloqueando el merge:

- `camino-del-dinero.spec.ts`: cobrar, cortar la red, encolar la venta, reconectar, sincronizar y recargar la pantalla.
- `responsive.spec.ts`: siete pantallas a 375, 768 y 1024 px, midiendo el documento.

```bash
pnpm --filter @pos-dian/pos-web test:e2e:install   # una vez
pnpm --filter @pos-dian/pos-web test:e2e
```

---

## Arquitectura Offline-First (PWA)

### Capas de Persistencia

| Capa | Tecnología | Base de Datos | Propósito |
|---|---|---|---|
| Catálogo (lectura) | Dexie.js | `pos-dexie-db` | Productos y clientes con TTL de 12h por `branch_id` |
| Cola de mutaciones (escritura) | IndexedDB nativo | `pos-dian-offline` | Ventas pendientes offline |
| Journal de operaciones | Dexie.js | `pos-journal-db` | Log de operaciones genéricas para sync |
| Fallback en memoria | `Map<string, ...>` | RAM | Si IndexedDB no está disponible (navegación privada, disco lleno) |
| Assets | Service Worker (Workbox) | Cache API | HTML, CSS, JS — acceso sin red |

### Estrategia de Resiliencia

- `useProductCatalog`: Intenta red → si falla, carga Dexie → si no hay caché, lanza error
- `navigator.storage.persist()` llamado en `main.tsx` para prevenir evicción por el SO (crítico en tablets iOS con poco espacio)
- `isClientUuidAlreadyRegistered` detecta HTTP 409 durante sync y lo trata como éxito (evita doble cobro)

---

## UX de Alta Velocidad (Cajero)

### Atajos de Teclado Globales

| Contexto | Tecla | Acción |
|---|---|---|
| Pantalla POS | `Ctrl+K` | Foco en buscador de productos |
| Buscador | `↑ / ↓` | Navegar lista de productos |
| Buscador | `Enter` | Agregar producto destacado al carrito |
| Buscador | `F4` | Abrir modal de cobro |
| Buscador | `P` | Aparcar carrito activo |
| Modal de cobro | `F1` | Seleccionar Efectivo |
| Modal de cobro | `F2` | Seleccionar Tarjeta |
| Modal de cobro | `F3` | Seleccionar Transferencia |
| Modal de cobro | `F4` | Seleccionar Pago Mixto |
| Modal de cobro | `Enter` | Confirmar venta (si formulario válido) |

### Multiplicador de Escáner

Sintaxis: `CANTIDAD*CÓDIGO_DE_BARRAS`  
Ejemplo: teclear o escanear `5*7701234567890` → agrega 5 unidades directamente.  
Funciona tanto desde teclado (campo de búsqueda) como desde escáner físico de hardware.

### Flujo Táctil Inteligente

- **Mesas Primero**: Si el módulo de mesas está activo, el cajero es recibido por la pantalla de Salones, desde donde con 1 tap ingresa al carrito de esa mesa en el POS.
- **Categorías Táctiles**: Sin texto en la barra de búsqueda, el POS muestra un `CategoryGrid` de botones grandes (optimizado para tablets) priorizando *Bebidas, Entradas, Platos Fuertes*, etc. Al seleccionar una, el grid de productos se filtra al instante.
- Al escribir en el buscador, el filtro táctil se interrumpe para priorizar la búsqueda global y de código de barras sin romper la agilidad.

### Responsive Táctil

Breakpoints CSS en `global.css`:
- `1280px`: sidebar del carrito → 340px
- `1024px`: sidebar → 300px, checkout 2 columnas
- `768px`: layout columna única con `grid-template-rows: 1fr auto`, scroll interno, sin scroll de página
- `640px / 480px / 380px`: ajustes tipografía, grillas y espaciados

**El armazón tiene que poder encogerse.** Los breakpoints estaban bien y la aplicación se salía de la pantalla igual: un hijo de grid nace con `min-width: auto` —«no me encojas por debajo del ancho mínimo de mi contenido»—, así que la columna implícita se dimensionaba al contenido más ancho y arrastraba la barra superior fuera de la ventana: 203 px de más en un móvil de 375, 118 en una tablet de 768. Por eso `.app-shell` declara `grid-template-columns: minmax(0, 1fr)`, los contenedores que envuelven contenido ancho llevan `min-width: 0` y `.topbar-user` envuelve.

Los controles suben a **44 px bajo `hover: none`**, acotado a punteros gruesos: con ratón sobran y solo gastarían barra.

Nada de esto se veía leyendo el CSS — se vio midiendo el documento en un navegador —, así que la garantía es una medición y no una regla de estilo: `e2e/responsive.spec.ts` recorre siete pantallas a 375, 768 y 1024 px y nombra al elemento culpable cuando falla. Se mide el documento, no cada componente: una tabla puede y debe desplazarse dentro de su propio contenedor (D-072).

---

## Integraciones de Hardware

### Impresión de Tickets
- **HTML dinámico:** Generación de ticket 58mm u 80mm en una ventana nueva. Selección guardada en configuración del tenant.
- **ESC/POS directo:** Conexión por Web Serial API (`navigator.serial`) a impresoras térmicas sin diálogos del sistema. Ver `ticket-printer.ts`.

### Datáfono
- `sendToPaymentTerminal()` en `hardware.ts` **es un simulador**: aprueba el 90 % de las veces con `Math.random()` y devuelve un código de autorización inventado. No hay conector con ningún adquirente.
- Lo que sí es real es el cierre de lote de la fase 9: se captura el total que imprime el datáfono y el sistema dice al momento si coincide con lo que registró y en qué se diferencia. Cuando exista el conector, lo único que cambia es de dónde salen esas cifras.

### Báscula Digital (Web Serial API)
- Archivo: `apps/pos-web/src/lib/hardware.ts` → `readScaleWeight()`
- Abre el puerto serial en baudRate 9600 (compatible Mettler, CAS y similares)
- Lee el peso, limpia el string (`"  0.450 kg\r\n"` → `0.450`) y lo aplica como cantidad del ítem del carrito
- Timeout de 2 segundos; errores presentados en un `alert` contextual

---

## Observabilidad Distribuida

### Stack (Infraestructura Local)

```
apps/api ──OTLP HTTP──► otel-collector ──► Prometheus (métricas)
                                       ──► Tempo (trazas)
                                       ──► Loki (logs)
                                             ↑
                                          Grafana
```

Configurado en `infra/docker-compose.obs.yml`. Levantar con:
```bash
cd infra && docker compose -f docker-compose.obs.yml up -d
```

### Instrumentación en API (`apps/api/src/tracing.ts`)

- OpenTelemetry Node SDK con auto-instrumentaciones (HTTP, PostgreSQL)
- Exporter OTLP HTTP: `OTLP_TRACE_ENDPOINT` (default `http://localhost:4318/v1/traces`)
- W3C Trace Context Propagator para trazas distribuidas entre servicios
- **Métricas de negocio custom** vía `posMeter`:
  - `pos.sales.count` — contador de ventas por tenant

### Worker

El worker loguea por job: `outbox_event_id`, `sale_id`, `tenant_id`, `attempt`, transición DIAN y resultado del provider.

---

## Roles y Permisos

| Rol | Permisos clave |
|---|---|
| `PLATFORM_OWNER` / `PLATFORM_ADMIN` | Control total del SaaS: Gestión de Tenants (crear, suspender, reactivar), cambio de planes de facturación, y CRUD transversal sobre los usuarios de cualquier Tenant. |
| `ADMIN` | Todo en su Tenant: configurar negocio, sucursales, usuarios, productos, anular ventas, dashboard global, auto-gestión de suscripción, control total de caja |
| `MANAGER` | Sus sucursales: administrar el personal de piso (cajeros y meseros), reportes, movimientos de inventario. **Sin** dashboard global, anulaciones ni facturación |
| `CASHIER` | Abrir/cerrar su caja, vender, ver historial de ventas, ver saldos de inventario |
| `WAITER` | Tomar pedidos en mesa y enviarlos a cocina. **Sin** caja, catálogo, usuarios ni anulaciones. Incluye `sales:create` porque las pantallas de Mesas y POS se habilitan con ese permiso (D-047) |
| `AUDITOR` | Solo lectura global: trazabilidad, alertas, audit logs |

Los roles se derivan de una sola lista (`USER_ROLES` en `packages/shared`); estuvieron escritos a mano en cinco sitios y desincronizados, con la consecuencia de que `WAITER` fue inalcanzable durante meses pese a existir en el enum de Postgres (D-045).

### Mesero ≠ usuario con rol `WAITER`

Son dos cosas distintas y conviene no confundirlas:

- La **plantilla de meseros** vive en la tabla `waiters` (nombre, PIN opcional, sucursal). Es lo que se asigna a una mesa: `tables.waiter_id`, `table_orders.waiter_id` y `sales.waiter_id` referencian `waiters.id` desde la migración 074.
- El **rol `WAITER`** es una cuenta de acceso a la aplicación, para el mesero que además usa una tablet. `waiters.user_id` los vincula cuando ambos existen, y es opcional.

La mayoría de los meseros de un restaurante no necesita cuenta. Ver D-046.

---

## Seguridad

### Aislamiento por tenant (RLS)

Es la única barrera que separa a un comercio de otro, así que conviene entender exactamente dónde vive.

**El mecanismo.** Cada petición que toca datos de negocio pasa por `executeAsTenant(db, tenantId, fn)`, que abre una transacción y ejecuta `set_config('app.current_tenant', <id>, true)` — el `true` es local a la transacción, de modo que el valor no se filtra a la siguiente petición que reutilice esa conexión del pool. Las políticas comparan:

```sql
tenant_id::text = current_setting('app.current_tenant', true)
```

Si nadie fijó la variable, `current_setting(..., true)` devuelve `NULL`, la comparación es `NULL` (no verdadera) y la consulta devuelve **cero filas**. Olvidar el contexto es un bug visible —una pantalla vacía—, no una fuga silenciosa.

**Quién se conecta.** El mecanismo anterior no sirve de nada si el rol de conexión salta las políticas, que es exactamente como estuvo el sistema hasta la fase 2: RLS habilitado, políticas escritas, y la API conectada con el dueño del esquema, que las ignora por definición. Desde entonces:

| Conexión | Rol | Para qué |
|---|---|---|
| `DATABASE_URL` | `pos_api` (miembro de `api_user`) | La API. Sin `BYPASSRLS`, sin `SUPERUSER`, sin DDL. |
| `ADMIN_DATABASE_URL` | dueño del esquema | Migraciones y semillas, nada más. |
| worker | dueño del esquema | Deliberado: bandeja de salida, rollups y renovaciones recorren todos los comercios por diseño. Su superficie de entrada son jobs propios, no peticiones de usuario. |

Todas las tablas de negocio llevan además `FORCE ROW LEVEL SECURITY`, para que ni el dueño se salte las políticas si alguien vuelve a apuntar la API allí por accidente.

**Lo que apareció al mover la conexión.** El cambio de rol destapó tres clases de defecto que llevaban meses ocultos, corregidos en la migración `088_rls_consistency`:

1. **Variable equivocada** (`order_rounds`, `tenant_dian_settings`): las políticas leían `app.current_tenant_id`, que nadie fija. Con RLS real habrían devuelto cero filas — y en el caso de `tenant_dian_settings` eso significa ninguna credencial del PAC, es decir, ninguna factura emitida.
2. **RESTRICTIVE sin permisiva** (6 tablas de restaurante y domicilios): en PostgreSQL una política restrictiva *acota* a las permisivas; sin ninguna permisiva que acotar, niega todo. Domicilios, meseros y cocina se habrían apagado por completo.
3. **Sin RLS** (10 tablas con `tenant_id`, incluida la partición por defecto de `audit_logs`): el aislamiento dependía enteramente de que ninguna consulta olvidara su `WHERE tenant_id`.

**Exclusiones deliberadas.** `refresh_tokens` queda fuera (D-015): el ciclo de autenticación necesita leerla *antes* de saber a qué tenant pertenece la petición. Las tablas de plataforma (`tenants`, `plans`, `subscription_events`) tampoco llevan política de tenant porque su alcance es transversal por naturaleza; su control es de rol, no de fila. La lista completa y su justificación están en D-038.

**Cómo se verifica.** `apps/api/src/shared/infra/db/__tests__/rls.spec.ts` corre contra PostgreSQL real: lectura cruzada por id, `UPDATE`/`DELETE` sobre filas ajenas, `INSERT` a nombre de otro tenant y `COUNT(*)` sin `WHERE`. Un `beforeAll` consulta `pg_roles` y **falla la suite** si el rol de conexión tiene `BYPASSRLS`, porque en ese caso las pruebas pasarían sin comprobar nada — que es precisamente lo que ocurría antes, con tres de ellas marcadas `skip`.

### Resto de controles

- **JWT:** Tokens de corta duración + refresh tokens por tenant. El token de sesión **no** se acepta por la URL salvo en streams SSE (`GET …/stream`), donde `EventSource` no admite cabeceras; ahí se redacta del log (D-049).
- **`JWT_SECRET`:** en producción se valida por variedad, no solo por longitud — se rechazan los marcadores de posición y los secretos de menos de 16 caracteres distintos (D-054).
- **Cabeceras:** `@fastify/helmet` con HSTS en producción y `referrer-policy: no-referrer`. Sin CSP a propósito: la API sirve JSON y Swagger, no el HTML de la aplicación (D-053).
- **`/metrics`:** cerrado en producción tras `METRICS_TOKEN`, con comparación en tiempo constante; sin token configurado responde 404 (D-050).
- **Rate Limiting:** Login con `AUTH_LOGIN_RATE_LIMIT_MAX` / `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`.
- **CORS:** Configurable por entorno (`CORS_ALLOWED_ORIGINS`).
- **Errores de validación:** 400 con el campo que falla, no 500 (D-048).
- **`request_id`:** Inyectado en todos los logs del API para trazabilidad por request.
- **`audit_logs`:** Apertura/cierre de caja, creación/anulación de venta, cambios fiscales y de catálogo.

---

## Diagrama de Flujo Completo

```mermaid
flowchart LR
  A["POS Web (PWA)"] --> B["POST /auth/login"]
  A -->|Idempotency-Key| G
  B --> C["SessionProvider (JWT + refresh)"]
  C --> D["Abrir caja\nPOST /cash-sessions/open"]
  D --> E["Catálogo Dexie\n(TTL 12h / fallback red)"]
  E --> F["Carrito + Checkout\n(Atajos F1-F4 · Escáner QTY*CODE)"]
  F --> G["POST /sales"]
  G --> H["sales + ledger\n(PostgreSQL FOR UPDATE)"]
  G --> I["idempotency_records"]
  G --> J["outbox SALE_CREATED"]
  J --> K["Worker BullMQ (Outbox)"]
  K --> L["Provider DIAN"]
  L --> M["SENT / ACCEPTED / REJECTED"]
  F --> N["Falla de red"]
  N --> O["Cola offline IndexedDB\n(pos-dian-offline)"]
  O --> P["Sync automático\nonline event"]
  P --> G
  U["Tables Screen"] --> V["POST /tables/:id/order"]
  V --> W["table_orders (DB)"]
  W --> X["POS Checkout\n(Cargar Pedido)"]
  X --> G
  Q["Admin Web"] --> R["Subir CSV/XLSX"]
  R --> S["Worker BullMQ (Bulk Import)"]
  S --> T["inventory_balances\n(Optimistic Lock)"]
```

---

## Pendientes para Producción

Plan completo y razonado en `docs/ROADMAP-PRODUCCION.md`.

| Ítem | Estado |
|---|---|
| Compilación, esquema desde cero y suite verde en CI | ✅ Fase 0 |
| Correcciones de negocio (stock, totales fiscales, caja, anulación, mock DIAN, credenciales cifradas) | ✅ Fase 1 |
| RLS aplicado por el motor con rol sin `BYPASSRLS` | ✅ Fase 2 |
| Apagado ordenado, `helmet`, `/metrics` autenticado, token fuera del query string | ✅ Fase 3 |
| Gestión de secretos en un gestor real y rotación de las credenciales de ejemplo | ⏳ Infraestructura |
| Numeración por resolución autorizada (prefijo, rango, consecutivo sin huecos) | ✅ Fase 4 |
| Cierre de ciclo para documentos en estado `SENT` (consulta + webhook + alerta) | ✅ Fase 4 |
| Domicilio entregado → venta → documento fiscal | ✅ Fase 4 |
| Provider DIAN real (PAC) **certificado** | ⏳ Depende del PAC — `docs/CERTIFICACION-PAC.md` |
| Escalado horizontal (advisory locks, adaptador Redis de Socket.io, `SKIP LOCKED`) | ⏳ Fase 5 — sin el adaptador, dos instancias desincronizan mesas y KDS |
| Recetas y escandallo, turnos de mesero, informes de operación, pedido por menú QR | ✅ Fase 10 |
| Enrutador con URL por pantalla, React Query en todas las pantallas, e2e del camino del dinero en CI | ✅ Fase 11 |
| Cliente del API generado desde el contrato | ⏳ La cadena existe y CI la vigila; `client.ts` sigue con 38 tipos a mano |
| Cobro desde el menú QR | ⏳ El comensal pide y pide la cuenta; el cobro es en caja |
| Nombre del producto congelado en `sale_items` | ⏳ Hoy solo se guarda `product_id`: renombrar reescribe el tiquete de una venta vieja |
| CORS sin cabecera `Origin`, y `ADMIN` / `TENANT_OWNER` fuera de la verificación de permisos | ⏳ Pendiente |
| Despliegue HTTPS, multi-instancia | ⏳ Pendiente |
| Políticas operativas: soporte, rotación de usuarios, ensayo real de restauración | ⏳ Pendiente |
| Observabilidad centralizada (stack Grafana) | ✅ Implementado localmente |
| Integración hardware (impresoras, báscula) | ✅ Implementado (Web Serial API) |
| **Backup automático PostgreSQL + GCS** | ✅ Implementado (GitHub Actions) — la *restauración* nunca se ha ensayado de punta a punta |
| **Medición SaaS (billing metrics)** | ✅ Implementado (snapshot scheduler) |
| **Feature Flags Jerárquicos** | ✅ Implementado (macro + micro) |

---

## Sistema de Feature Flags (D-029)

El SaaS gestiona las funcionalidades de cada tenant mediante un sistema jerárquico de dos capas almacenado en `tenants.modules_json`.

### Flags Macro (habilitación de módulo completo)

| Flag | Módulo |
|---|---|
| `enable_restaurant` | Flujo de restaurante (mesas, meseros) |
| `enable_kds` | Kitchen Display System |
| `enable_delivery` | Módulo de domicilios |
| `enable_inventory` | Inventario avanzado |
| `enable_reservations` | Reservas de mesas |
| `enable_fiscal` | Facturación electrónica DIAN |
| `enable_loyalty` | Programa de fidelización |
| `enable_advanced_reports` | Reportes avanzados |

### Flags Micro (granulares por módulo)

Activables solo cuando su Macro padre está activo. Al desactivar el Macro, los Micro se desactivan en cascada preservando su estado para reactivación futura.

```
enable_restaurant
  ├── enable_tables
  ├── enable_split_bill
  ├── enable_guests_count
  ├── enable_tips
  ├── enable_modifiers
  ├── enable_courses
  ├── enable_kds           (también Macro)
  └── enable_kitchen_printing
```

---

## Medición SaaS / Billing Metrics (D-031, D-034)

### Arquitectura de Medición

```
Fastify onResponse hook
  └── billingUsagePlugin
        └── RAM counter (Map<tenant_id, count>)
              └── [cada 50 requests] → INSERT outbox_events (api_metric_tick)

Worker nocturno [rollupBillingUsage]
  ├── COUNT(sales) WHERE status='COMPLETED' AND period
  ├── COUNT(DISTINCT user_id) FROM user_branches
  ├── COUNT(branches) WHERE tenant_id
  ├── SUM(size_bytes) FROM product_images
  ├── COUNT(outbox_events) WHERE type != 'api_metric_tick'
  └── SUM(payload_json->>'count') FROM outbox_events WHERE type='api_metric_tick'
        └── INSERT subscription_events (USAGE_SNAPSHOT, metadata JSON)
```

### Consulta del último snapshot

```sql
SELECT metadata
FROM subscription_events
WHERE subscription_id = $1
  AND type = 'USAGE_SNAPSHOT'
ORDER BY created_at DESC
LIMIT 1;
```

---

## Estrategia de Backup y Recuperación (D-032, D-033)

### PostgreSQL

| Parámetro | Valor |
|---|---|
| Herramienta | `pg_dump` formato custom |
| Frecuencia | Diario a las 02:00 UTC |
| Almacenamiento | Google Cloud Storage |
| Retención | 30 días (purga automática) |
| RPO (pérdida máxima) | ~24 horas |
| RTO (tiempo de recuperación) | ~30–60 minutos |
| Validación | Semanal (domingos, instancia efímera) |
| Costo | ~$0.35 USD/mes |

### Scripts de Operación

```bash
# Backup manual
bash infra/scripts/pg-backup-gcs.sh

# Restore desde GCS
bash infra/scripts/pg-restore.sh gs://pos-dian-backups/postgres/pos_dian_YYYYMMDD.dump

# Validación de integridad
bash infra/scripts/pg-validate-restore.sh
```

### GitHub Actions

- **`backup-database.yml`**: Cron diario (`0 2 * * *`) + validación dominical (`0 3 * * 0`).
- Requiere 3 secrets: `DATABASE_URL_PRODUCTION`, `GCS_BACKUP_BUCKET`, `GCP_SA_KEY`.

### Redis

Configurado con persistencia dual:
- **AOF** (`appendfsync everysec`): máxima pérdida de 1 segundo de datos.
- **RDB** (`save 900 1 / 300 10 / 60 1000`): snapshots automáticos para backup.

