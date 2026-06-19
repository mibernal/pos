# ARCHITECTURE

> Última actualización: Junio 2026

## Objetivo

`pos-dian` es un POS multi-tenant para Colombia, orientado a operación real de caja y cumplimiento DIAN sin meter la emisión fiscal dentro del request de venta. Diseñado bajo los principios de **desacoplamiento asíncrono**, **offline-first** y **observabilidad distribuida** desde el primer día.

---

## Componentes del Sistema

| Componente | Stack | Rol |
|---|---|---|
| `apps/api` | Fastify · TypeScript · Kysely · Zod · OpenTelemetry | Auth, sucursales, caja, catálogo, ventas, configuración fiscal, billing, importaciones masivas, trazas OTLP y backoffice global SaaS |
| `apps/worker` | BullMQ · TypeScript · PostgreSQL | Consumo del outbox, DIAN, importaciones masivas (Enterprise), Schedulers (Limpieza, Alertas, Rollups) |
| `apps/pos-web` | React · Vite · Dexie.js · PWA (Workbox) | Shell POS offline-first, backoffice (Identity, Tenants), Control Center SuperAdmin, historial y configuración |
| `packages/shared` | TypeScript · Zod | Contratos, tipos y esquemas compartidos entre API, worker y web |

---

## Entidades Clave (Modelo de Datos)

- **`tenants` / `tenant_subscriptions` / `billing_plans`**: Gestión multi-tenant y modelo SaaS prepago.
- **`users` / `user_branches`**: RBAC (PlatformOwner, TenantOwner, Admin, Cashier, Manager).
- **`inventory_balances` / `inventory_ledger` / `inventory_adjustments`**: Fuerte consistencia de inventario (Optimistic Locking & Ledger inmutable).
- **`sales` / `sale_items` / `sales_ledger`**: Venta operativa con protección por idempotencia (`client_uuid`).
- **`deliveries` / `delivery_items` / `delivery_persons`**: Módulo de domicilios con seguimiento de estados (Pending, En Camino, etc.) y facturación asíncrona.
- **`rooms` / `tables` / `table_orders` / `table_order_items`**: Módulo de gestión de mesas y pedidos presenciales (sincronizados con backend para control centralizado de cuentas).
- **`payment_transactions`**: Transacciones de pago y webhooks de pasarelas (Wompi, MercadoPago).
- **`bulk_import_jobs`**: Control de cargas masivas de catálogo procesadas en background.
- **`idempotency_records`**: Tracking de peticiones seguras (ej. creación de ventas) con TTL de 24h.
- **`dian_documents` / `outbox_events`**: Orquestación asíncrona de facturación electrónica.

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
5. Repartidor entrega → DELIVERED → Se dispara la facturación electrónica/creación de Sale.
6. Si el cliente paga por adelantado, la facturación se asocia de inmediato y el cobro se asegura antes del envío.
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

---

## Integraciones de Hardware

### Impresión de Tickets
- **HTML dinámico:** Generación de ticket 58mm u 80mm en una ventana nueva. Selección guardada en configuración del tenant.
- **ESC/POS directo:** Conexión por Web Serial API (`navigator.serial`) a impresoras térmicas sin diálogos del sistema. Ver `ticket-printer.ts`.

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
| `MANAGER` | Sus sucursales: administrar cajeros, reportes, movimientos de inventario. **Sin** dashboard global, anulaciones ni facturación |
| `CASHIER` | Abrir/cerrar su caja, vender, ver historial de ventas, ver saldos de inventario |
| `AUDITOR` | Solo lectura global: trazabilidad, alertas, audit logs |

---

## Seguridad

- **RLS (Row Level Security):** PostgreSQL enforced por `tenant_id` en datos de negocio. `refresh_tokens` excluida de RLS (D-015) para permitir el ciclo de autenticación.
- **JWT:** Tokens de corta duración + refresh tokens por tenant.
- **Rate Limiting:** Login con `AUTH_LOGIN_RATE_LIMIT_MAX` / `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`.
- **CORS:** Configurable por entorno (`CORS_ALLOWED_ORIGINS`).
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

| Ítem | Estado |
|---|---|
| Provider DIAN real (PAC) certificado | ⏳ Pendiente |
| Consulta/webhook para documentos en estado `SENT` | ⏳ Pendiente |
| Despliegue HTTPS, secretos, backups, multi-instancia | ⏳ Pendiente |
| Políticas operativas: soporte, rotación de usuarios, recuperación | ⏳ Pendiente |
| Observabilidad centralizada (stack Grafana) | ✅ Implementado localmente |
| Integración hardware (impresoras, báscula) | ✅ Implementado (Web Serial API) |
