# DECISIONS

> Registro de decisiones arquitectónicas (ADR). Cada entrada documenta el contexto, la decisión tomada y el motivo.  
> **No eliminar entradas anteriores** aunque queden obsoletas; añadir nota de supersesión si aplica.

---

## D-001 — Multi-tenant y multi-sucursal desde el inicio
- `tenant_id` es obligatorio en todos los datos de negocio.
- `branch_id` se usa en el flujo operativo de caja y ventas.
- **Motivo:** Evitar re-arquitectura cuando el cliente pasa de una caja a varias sucursales.

## D-002 — Caja modelada como sesión explícita
- La caja abre, opera y cierra sobre `cash_sessions`.
- **Motivo:** El arqueo, la restricción de caja abierta y la operación diaria quedan trazables.

## D-003 — Emisión DIAN desacoplada por outbox + worker
- API registra venta y responde rápido.
- Worker toma `SALE_CREATED`, llama al provider y actualiza estados.
- **Motivo:** El POS no debe depender en línea del proveedor fiscal; una caída de la DIAN no puede bloquear la caja.

## D-004 — Idempotencia comercial con `client_uuid`
- Cada venta usa `client_uuid` generado en `pos-web` con `crypto.randomUUID()`.
- API devuelve la misma venta si ese `client_uuid` ya existe para el tenant (HTTP 409).
- El motor de sync (usePendingSalesSync) trata el 409 como éxito, evitando el doble cobro.
- **Motivo:** Prevenir duplicados en reintentos de red y sincronización offline.

## D-005 — Frontend POS modular con shell delgado
- `App.tsx` compone sesión, caja, navegación y modales.
- La lógica vive en `features/*`, `hooks/*` y `lib/*`.
- **Motivo:** Permitir crecer a operación real sin concentrar todo en un solo componente.

## D-006 — Precio final en POS; cálculo fiscal en backend
- El cajero trabaja con precio final y descuento.
- API resuelve `tax_mode`, `tax_category`, `tax_total_cents` y `tax_lines_json`.
- **Motivo:** Mantener UX simple y evitar lógica fiscal en el frontend.

## D-007 — Consecutivo de venta por sucursal
- `sale_number` se asigna por `tenant_id + branch_id` dentro de una transacción.
- La regla vive en `sale-numbering-service` con constraint único como defensa final.
- **Motivo:** Soportar concurrencia real sin lógica inline dispersa.

## D-008 — Cola offline local y sincronización automática
- `pos-web` guarda ventas pendientes solo ante error de red (IndexedDB `pos-dian-offline`).
- La cola reutiliza `POST /sales` con el mismo `client_uuid`.
- La sincronización es automática al reconectar (listener `window.online`) o manual.
- **Motivo:** Robustez comercial simple sin resolver conflictos de CRDT ni eventos distribuidos complejos.

## D-009 — Anulación de venta endurecida y solo para `ADMIN`
- La anulación exige motivo y persiste `void_reason`, `voided_by_user_id` y `voided_at`.
- El ticket y la UI reflejan `VOID`.
- **Motivo:** Trazabilidad operativa y control de riesgo en caja.

## D-010 — Perfil comercial mínimo centralizado en tenant
- `business_name`, `nit`, `address`, `phone` y `footer_message` viven en `tenants`.
- La sucursal complementa el ticket con nombre y dirección del punto de venta.
- **Motivo:** Ticket y demo consistentes sin convertir el sistema en un ERP.

## D-011 — Máquina de estados DIAN centralizada en el worker
- Las transiciones válidas viven en un helper dedicado.
- `ACCEPTED` y documentos con `CUDE` no se reemiten.
- **Motivo:** Evitar transiciones inválidas y simplificar el mantenimiento del flujo fiscal.

## D-012 — Seguridad y observabilidad básicas por defecto
- Login con rate limit configurable por env.
- CORS configurable por env.
- `request_id`, logs estructurados y `audit_logs` en todas las operaciones críticas.
- **Motivo:** Dejar una base razonable para ambientes reales sin introducir una plataforma enterprise.

## D-013 — Documento fiscal por tipo
- `dian_documents.document_type` separa `INVOICE` y `CREDIT_NOTE`.
- Las notas crédito usan `parent_document_id` para apuntar a la factura original.
- `GET /sales/:id` mantiene `dian_document` como factura principal para no romper clientes existentes.
- **Motivo:** Una nota crédito debe tener estado y CUDE propios; reutilizar la factura aceptada produce transiciones inválidas.

## D-014 — Provider HTTP estricto
- El provider HTTP no asume respuestas desconocidas como `ACCEPTED`.
- `ACCEPTED` requiere `cude`, `CUDE` o `uuid` en la respuesta; de lo contrario el worker falla y reintenta.
- **Motivo:** Evitar falsos positivos fiscales ante proveedores mal configurados o payloads inesperados.

## D-015 — RLS excluida de `refresh_tokens`
- La tabla `refresh_tokens` no tiene Row Level Security a diferencia del resto del esquema.
- Migración `043_remove_rls_from_refresh_tokens.ts`.
- **Motivo:** El ciclo de autenticación (refresh de token) ocurre antes de que el contexto de tenant esté inyectado en la sesión de PostgreSQL. Aplicar RLS rompía el endpoint `/auth/refresh` con un error 500 ya que `current_setting('app.current_tenant')` no está disponible en ese punto.

## D-016 — Observabilidad distribuida con OpenTelemetry SDK (no propietaria)
- `apps/api` instrumenta trazas HTTP, consultas DB y métricas de negocio usando `@opentelemetry/sdk-node`.
- Los datos se exportan vía OTLP HTTP al collector (`otel-collector`), compatible con cualquier backend (Jaeger, Grafana Tempo, Datadog, New Relic).
- El stack local usa: OTel Collector → Prometheus + Tempo + Loki → Grafana.
- Variables de entorno: `OTLP_TRACE_ENDPOINT`, `OTLP_METRICS_ENDPOINT`.
- **Motivo:** Evitar vendor lock-in en la capa de observabilidad. OTLP es el estándar de industria para telemetría neutral.

## D-017 — Almacenamiento offline persistente con doble capa de fallback
- `navigator.storage.persist()` se solicita al iniciar `main.tsx` para elevar la prioridad del storage en el SO.
- Dexie.js (`pos-dexie-db`) para catálogo con TTL de 12h por `branch_id`.
- IndexedDB nativo (`pos-dian-offline`) para la cola de ventas pendientes.
- Si IndexedDB no está disponible (navegación privada severa, cuota excedida), ambas capas caen a un `Map` en memoria con la misma interfaz.
- **Motivo:** Tablets con poco espacio pueden purgar IndexedDB silenciosamente. La persistencia explícita y el fallback en memoria garantizan que ninguna venta se pierda durante la sesión activa del navegador.

## D-018 — Atajos de teclado globales y multiplicador de escáner como primera clase
- Los atajos `F1–F4` (métodos de pago), `Enter` (confirmar), `Ctrl+K` (búsqueda) y `F4` (abrir cobro) son funcionalidades de primera clase, no un add-on.
- El multiplicador `QTY*BARCODE` es interpretado tanto por `useBarcodeScanner` (escáner físico) como por el campo de búsqueda del POS.
- **Motivo:** En una operación real de caja, reducir el tiempo promedio de venta de 15–20 segundos a menos de 5 segundos (flujo teclado-only) es una ventaja competitiva directa. Un cajero que procesa 200 ventas/día ahorra ~30 minutos diarios solo con los atajos de teclado.

## D-019 — Idempotencia estricta en base de datos
- Se utiliza el middleware `idempotency.plugin.ts` que intercepta peticiones que tengan la cabecera `Idempotency-Key`.
- El plugin guarda la petición original y la respuesta (`response_body_json`) en `idempotency_records` con un TTL de 24 horas.
- **Motivo:** Evita cargos y movimientos de inventario duplicados en situaciones donde el frontend envía peticiones repetidas debido a fallas de red (retry storms) o doble clic de los usuarios.

## D-020 — Fuerte consistencia de inventario (Locking mixto)
- Las transacciones de venta (`create-sale.service.ts`) utilizan **Pessimistic Locking** (`SELECT ... FOR UPDATE`) sobre la tabla de saldos de inventario.
- Los ajustes de inventario manuales (`inventory/adjust`) utilizan **Optimistic Locking** (`version` column) para que el front-end maneje posibles colisiones concurrentes.
- **Motivo:** Las ventas automáticas por POS son de alta frecuencia y deben resolverse en el motor de DB bloqueando la fila. Los ajustes de inventario manuales provienen de humanos en el backoffice, por lo que fallar rápido con `HTTP 409` es preferible.

## D-021 — Enterprise Bulk Import mediante BullMQ
- La carga masiva de catálogos (hasta 50,000 productos) se recibe vía Multipart (`@fastify/multipart`) en API y se envía como *job* al Worker mediante `bulk-import-queue`.
- El procesamiento se divide en *chunks* (baches), usando colas de Redis.
- **Motivo:** Evitar timeouts del servidor web (Fastify) y el acaparamiento de memoria (OOM). Permite a la UI mostrar estado de la importación de manera no bloqueante.

## D-022 — SaaS Billing y Webhooks centralizados
- Se integra la tabla `payment_transactions` y el contexto `billing` para aislar los cobros del SaaS de las ventas propias del cliente.
- Soporte agnóstico a múltiples pasarelas (Wompi, MercadoPago) a través de un único enrutador de webhooks `/api/v1/webhooks/:gateway`.
- **Motivo:** Facilitar la comercialización escalable del sistema y dejar un molde extendible a otras pasarelas, con validación de firmas y cambio atómico del plan del Tenant.

## D-023 — Gestión de Usuarios Multi-Tenant por SuperAdmin
- El `PLATFORM_OWNER` o `PLATFORM_ADMIN` tiene acceso a crear, modificar, y eliminar usuarios de cualquier tenant directamente desde el panel de SuperAdmin (Platform).
- **Motivo:** Evita que el equipo de soporte de la plataforma necesite impersonar (login as) o pedir contraseñas a los tenants para ayudarles con la gestión básica de su personal o recuperación de cuentas críticas.

## D-024 — Auto-gestión de suscripciones por el ADMIN
- El rol `ADMIN` del tenant (y no solo los propietarios) tiene permisos para generar sesiones de checkout y cambiar el plan de suscripción (`PATCH /billing/checkout/:gateway`).
- **Motivo:** Da autonomía al gerente/dueño del restaurante para pagar su factura o mejorar su plan sin necesidad de interactuar con el soporte de la plataforma.

## D-025 — Despliegue Docker con pnpm v10 y workspaces inyectados
- Se fija `pnpm` a la versión `v10` a través de `packageManager` en el `package.json` raíz.
- Se adopta la configuración `inject-workspace-packages=true` globalmente a través del archivo `.npmrc`.
- Las dependencias locales (como `@pos-dian/shared`) son inyectadas en lugar de enlazadas por symlinks durante la compilación.
- **Motivo:** A partir de pnpm v10, el comando `pnpm deploy` exige que los workspaces estén inyectados para asegurar el aislamiento estricto y la inmutabilidad de los contenedores Docker en producción, eliminando el uso de hacks como la bandera `--legacy`.

## D-026 — Ruteo táctil de Salones y Categorías en el POS
- Los tenants con el módulo `tables` inician la sesión de caja en una vista de Salones en lugar de ir directamente al POS.
- Al ingresar al POS sin una búsqueda activa, se muestra un `CategoryGrid` táctil priorizado (Bebidas, Entradas, etc.) en vez del listado completo.
- **Motivo:** Maximizar la agilidad en escenarios gastronómicos (restaurantes, bares) que operan con tablets, donde escribir en un teclado virtual es lento y la navegación por jerarquía visual es fundamental.

## D-027 — Desacople de Facturación en Domicilios (Deliveries)
- Un domicilio transita por estados operativos (`PENDING`, `PREPARATION`, `ON_WAY`) sin emitir factura electrónica ni rebajar el stock central inmediatamente.
- La creación de la entidad `Sale` (y posterior emisión DIAN) se dispara exclusivamente cuando el domicilio pasa a estado `DELIVERED`, o cuando es pagado por anticipado.
- **Motivo:** Prevenir facturación de pedidos cancelados o rechazados en puerta, reduciendo dramáticamente el volumen de Notas Crédito operativas.

## D-028 — Sincronización backend de pedidos en mesas (table_orders)
- Los pedidos asignados a una mesa se persisten explícitamente en base de datos (`table_orders` y `table_order_items`) y no solo localmente (IndexedDB/State).
- Cada mesa (`tables`) mantiene una referencia opcional `current_order_id`.
- **Motivo:** Asegura que distintos cajeros/meseros puedan ver las cuentas en vivo de las mesas. Previene la mezcla local de pedidos y centraliza la totalización real de la cuenta de restaurante.

## D-029 — Sistema Jerárquico de Feature Flags (Macro + Micro)
- Los Feature Flags del SaaS se organizan en dos capas: **Macro** (habilitan un módulo completo: `enable_restaurant`, `enable_kds`, `enable_delivery`, `enable_inventory`, `enable_reservations`, `enable_fiscal`, `enable_loyalty`, `enable_advanced_reports`) y **Micro** (granulares dentro de cada módulo: `enable_tables`, `enable_split_bill`, `enable_guests_count`, `enable_tips`, `enable_modifiers`, `enable_courses`, `enable_kds`, `enable_kitchen_printing`).
- Al desactivar un Macro flag, sus Micro flags dependientes se desactivan en cascada. Al activar un Macro, los Micro recuperan su último estado.
- La lógica de validación vive en el backend (Zod) y en el `platform-admin.repository.ts`.
- Migración: `086_hierarchical_feature_flags.ts`.
- **Motivo:** Evitar que un tenant pague por funcionalidades que no usa, sin obligar a mantener una tabla de configuración por módulo por tenant (complejidad exponencial). Un solo JSON en `tenants.modules_json` es suficiente para un SaaS pequeño.

## D-030 — Eliminación del Módulo "Dashboard Live" (Consolidación)
- El módulo `DashboardScreen` (métricas en tiempo real via SSE) fue eliminado como pantalla independiente.
- Su lógica de SSE y gráficas fue extraída a `LiveMetricsTab.tsx` e integrada como una nueva pestaña **⚡ En Vivo** dentro de `ReportsScreen`.
- Archivos eliminados: `DashboardScreen.tsx`, `GlobalDashboardScreen.tsx`. Ruta `dashboard` eliminada de `routes.ts` y `App.tsx`.
- **Motivo:** El módulo era redundante con Reportes. Consolidarlo reduce la superficie cognitiva del menú y elimina código duplicado sin perder funcionalidad.

## D-031 — Medición SaaS por Snapshots en subscription_events
- El sistema de medición de uso (billing metrics) no usa tablas adicionales.
- Un scheduler nocturno (`rollup-billing-usage.scheduler.ts`) calcula por tenant: `sales_count`, `active_users_count`, `branches_count`, `storage_bytes`, `jobs_count` y `api_calls_count`.
- Los resultados se insertan en `subscription_events` con `type = 'USAGE_SNAPSHOT'` y metadata JSON.
- El consumo de API se acumula en memoria (batches de 50 requests) antes de volcarse al outbox como `api_metric_tick`.
- **Motivo:** Evitar la creación de un sistema de billing paralelo. La tabla `subscription_events` ya existía y su columna `metadata: JsonColumn` es perfecta para almacenar snapshots evolutivos sin migraciones futuras.

## D-032 — Backup Automático con pg_dump + GCS + GitHub Actions
- El backup de PostgreSQL se ejecuta diariamente a las 02:00 UTC mediante un workflow de GitHub Actions.
- El dump se genera en formato custom de `pg_dump` (comprimido, optimizado para `pg_restore`) y se sube a Google Cloud Storage.
- La retención es de 30 días con purga automática de archivos más antiguos.
- Una validación semanal (domingos) restaura el backup más reciente en una instancia efímera de Postgres y verifica la integridad de tablas críticas.
- Scripts: `infra/scripts/pg-backup-gcs.sh`, `pg-restore.sh`, `pg-validate-restore.sh`.
- **Motivo:** Costo total ~$0.35 USD/mes. No requiere herramientas externas (Barman, pgBackRest). GitHub Actions Free Tier es suficiente para una operación SaaS pequeña.

## D-033 — Redis con Persistencia Dual (AOF + RDB)
- La configuración de Redis en producción habilita tanto AOF (`appendonly yes`, `appendfsync everysec`) como snapshots RDB (`save 900 1`, `save 300 10`, `save 60 1000`).
- AOF garantiza durabilidad de escrituras (máxima pérdida: 1 segundo). RDB provee snapshots comprimidos para backup rápido.
- `stop-writes-on-bgsave-error yes` evita pérdida silenciosa de datos si el snapshot falla.
- **Motivo:** Con solo `appendonly yes` (configuración anterior), un fallo del volumen Docker eliminaba los jobs BullMQ en vuelo. La persistencia dual elimina ese riesgo sin costo adicional.

## D-034 — Billing Usage Plugin con Batching en Memoria
- El plugin `billing-usage.plugin.ts` (Fastify `onResponse` hook) cuenta peticiones autenticadas por tenant en un `Map<tenant_id, count>` en RAM.
- Al llegar a 50 requests por tenant, inserta de forma asíncrona (fire-and-forget) un evento `api_metric_tick` en `outbox_events`.
- El Worker procesa estos ticks marcándolos como `SENT` (no requieren acción real, solo contabilización).
- **Motivo:** Registrar cada petición API directamente en Postgres generaría ~200 ms de overhead adicional por request y colapsaría la DB en tenants de alto volumen. El batching en memoria reduce el I/O de base de datos en 98%.

## D-035 — Arquitectura Multi-PAC para Integración Fiscal (DIAN)
- El envío a la DIAN no está acoplado a un único proveedor global.
- Cada tenant configura su proveedor (`SIIGO`, `ALEGRA`, `FACTURA1`, etc.) y sus credenciales JSON en la tabla `tenant_dian_settings`.
- El Worker utiliza un Patrón Factory (`buildDianProvider()`) para inyectar dinámicamente el adaptador adecuado en tiempo de procesamiento del outbox.
- **Motivo:** En un modelo SaaS, es inviable forzar a todos los clientes a facturar a través de un único Proveedor Tecnológico. Esta arquitectura permite abstraer los payloads específicos de cada PAC manteniendo una interfaz centralizada `DianProvider`.

