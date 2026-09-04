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


## D-036 — El aislamiento entre comercios lo impone PostgreSQL, no la disciplina de quien consulta
- La API se conecta con el rol `pos_api` (miembro de `api_user`), **sin BYPASSRLS**. Toda consulta con datos de un comercio pasa por `executeAsTenant()`, que fija `app.current_tenant` con `SET LOCAL` dentro de la transacción.
- Migraciones y semillas usan `ADMIN_DATABASE_URL` (el rol dueño del esquema): hacen DDL y siembran filas de varios comercios, cosa que el rol restringido no puede —ni debe— hacer.
- El worker también usa el rol dueño: sus tareas programadas (bandeja de salida, rollups, renovaciones, alertas) recorren todos los comercios por diseño. El trabajo *por comercio* sí fija el contexto con `executeAsTenantClient()`.
- El rol de la API se crea con `./infra/scripts/create-api-role.sh` **después** de migrar.
- **Motivo:** hasta agosto de 2026 el RLS estaba encendido en la base pero era decorativo, porque la API se conectaba con el dueño del esquema y lo saltaba. El aislamiento dependía por entero de que ninguna de las 138 rutas olvidara su `WHERE tenant_id`. Un solo descuido era una fuga de datos entre comercios.

## D-037 — Coherencia de las políticas RLS (migración 088)
- Todas las políticas de aislamiento son **PERMISSIVE**, usan `app.current_tenant` y van acompañadas de `FORCE ROW LEVEL SECURITY`.
- Corregido en la migración 088:
  - `order_rounds` y `tenant_dian_settings` usaban `app.current_tenant_id`, una variable que nadie fija. Con RLS aplicado habrían devuelto cero filas: rondas de cocina vacías y —peor— ninguna credencial del PAC, es decir ninguna factura emitida.
  - Seis tablas de restaurante y domicilios (`deliveries`, `delivery_items`, `delivery_persons`, `waiters`, `kitchen_tickets`, `kitchen_ticket_items`) tenían política **solo RESTRICTIVE**. En PostgreSQL una restrictiva sin permisiva que la acompañe niega todo.
  - Diez tablas con `tenant_id` no tenían RLS en absoluto (`branches`, `rooms`, `tables`, `reservations`, `suppliers`, `product_images`, `product_modifier_groups`, `product_modifier_options`, `bulk_import_jobs` y la partición `audit_logs_default`).
- **Motivo:** con RLS decorativo estos defectos eran invisibles. Al pasar a un rol sin BYPASSRLS habrían apagado módulos enteros el primer día.

## D-038 — Tablas deliberadamente fuera de RLS
Se documentan porque la ausencia de política es una decisión, no un olvido:

| Tabla | Motivo |
|---|---|
| `users`, `refresh_tokens` | El login y el refresh ocurren antes de que exista contexto de tenant; además su `tenant_id` es nulo para roles de plataforma. Ver D-015. |
| `platform_events` | `tenant_id` nulo para eventos de plataforma. |
| `tenant_subscriptions`, `payment_transactions`, `tenant_module_audit_logs` | Las lecturas del SuperAdmin (MRR, ARR, auditoría de módulos) son transversales a todos los comercios por definición. El control es de permisos (`platform:*`), no de fila. |
| `idempotency_records` | El plugin de idempotencia actúa antes de resolver el tenant de la petición. |
| `tenants`, `billing_plans`, `platform_settings`, `subscription_events`, `impersonation_sessions` | Son globales: no tienen `tenant_id`. |

## D-039 — El servidor es la única fuente de los valores fiscales
- `create-sale.service.ts` calcula subtotal, descuento, impuesto y total a partir de los precios de línea y de la `tax_category` que el producto tiene en base de datos. El `snapshot` que envía el cliente se **compara**, nunca se copia.
- Si difiere, la discrepancia queda registrada en la auditoría de la venta (`audit_payload.snapshot_discrepancy`). Si el precio de una línea se desvía más del 10% del catálogo, la venta se rechaza con `PRICE_DRIFT_EXCEEDED`.
- **Motivo:** antes el snapshot sobrescribía los cuatro valores, de modo que un frontend comprometido o con un error podía fijar la base gravable que viajaba al documento DIAN, con solo un 10% de margen como barrera. La venta offline sigue facturándose por lo que se cobró, porque cada ítem envía su `price_cents` y el servidor calcula sobre ellos; lo que ya no puede venir del cliente es el impuesto.

## D-040 — Las credenciales del PAC se guardan cifradas
- `tenant_dian_settings.credentials` almacena un sobre AES-256-GCM (`packages/shared/src/crypto/secret-box.ts`). La clave vive en `CREDENTIALS_ENCRYPTION_KEY`, obligatoria en producción.
- El worker rechaza credenciales en texto plano cuando `NODE_ENV=production`; fuera de producción las acepta con un aviso.
- Se generan y cifran con `pnpm --filter @pos-dian/worker encrypt-credentials`.
- **Motivo:** en claro, un volcado de la base o un respaldo mal guardado entrega la capacidad de emitir documentos fiscales a nombre de todos los comercios a la vez.

## D-041 — Una alerta no puede tumbar una venta
- La alerta de bajo stock se acumula durante el descargo de inventario y se publica **después** del commit, en su propia transacción y con su propio manejo de error.
- **Motivo:** la publicación vivía dentro de la transacción de descargo y usaba una columna inexistente (`event_type`). Cuando un producto cruzaba su mínimo, la transacción hacía rollback, el inventario no se descargaba y la factura DIAN de esa venta no se emitía nunca: el evento quedaba reintentándose en bucle cada cinco segundos.

## D-042 — Anular antes de emitir no manda la factura a la DIAN
- El evento `sale.voided` se publica **siempre**, exista o no ya el documento. El procesador de `sale.created` comprueba el estado de la venta antes de emitir y omite la emisión si está anulada; el de `sale.voided` distingue «la factura nunca salió» (nada que anular) de «la factura ya fue aceptada» (nota crédito).
- **Motivo:** el evento de anulación solo se publicaba si ya existía el documento —que crea el worker—, así que anular dentro de la ventana del worker (el caso más común: el cajero se equivoca y anula de inmediato) mandaba la factura a la DIAN sin nota crédito.

## D-043 — `no-explicit-any` es un aviso, `no-unused-vars` es un error
- ESLint reporta `@typescript-eslint/no-explicit-any` como *warning* (~142 avisos) y `no-unused-vars` como *error*.
- **Motivo:** un `any` es deuda medible que conviene bajar con el tiempo, pero no un defecto de corrección; como error bloqueaba el build y el equipo terminaba desactivando el gate entero. Una variable sin usar, en cambio, casi siempre señala código muerto o cableado incompleto: de los 65 que había salieron varios defectos reales (props recibidas y nunca invocadas, un `refreshSession` declarado pero no recibido).

## D-044 — El manejador de errores se registra con `fastify-plugin`
- `errorHandlerPlugin` va envuelto en `fp()`.
- **Motivo:** Fastify encapsula los plugins. Sin `fp`, `setErrorHandler` y `setNotFoundHandler` quedaban confinados al ámbito (vacío) del propio plugin y **ninguna ruta hermana los usaba**: la API respondía con el formato por defecto de Fastify en vez del contrato `{ error: { code, message, details } }`, el registro estructurado de errores no se ejecutaba nunca, los 500 devolvían el mensaje interno sin sanear, y la detección de `QUOTA_EXCEEDED` en el frontend jamás disparaba.

## D-045 — Los roles se derivan de una sola lista
- `USER_ROLES` en `packages/shared/src/schemas/auth.ts` es la única definición. De ahí salen el `UserRole` del paquete compartido, el del API, el del esquema de base y el `z.enum` de las rutas de usuarios. `apps/api/src/shared/infra/security/roles.test.ts` falla si un rol se queda sin permisos o sin nivel de jerarquía.
- **Motivo:** los roles estaban escritos a mano en cinco sitios y llevaban meses desincronizados. `WAITER` existía en el enum de Postgres desde la migración 066 y en el esquema compartido, pero no en el tipo del API ni en el `z.enum` de la ruta de creación de usuarios: **no había forma de crear un mesero por ninguna vía**, ni por la interfaz ni por la API. El coste de derivar es una línea; el de no hacerlo fue una funcionalidad completa inalcanzable en producción.

## D-046 — Un mesero es una fila de `waiters`, no un usuario
- `tables.waiter_id`, `table_orders.waiter_id` y `sales.waiter_id` apuntan a `waiters.id` desde la migración 074. La plantilla de meseros se administra en la pantalla **Meseros** y es independiente de las cuentas de acceso; `waiters.user_id` es opcional y solo vincula un mesero con su cuenta cuando existe.
- **Motivo:** en un restaurante la mayoría de los meseros no necesita cuenta —el pedido lo captura quien tiene la tablet—, y forzar un usuario por mesero convierte cada contratación en un alta de acceso. La consecuencia de no tenerlo claro fue concreta: `AssignWaiterModal` listaba *usuarios* y enviaba `users.id` a un campo que referencia `waiters.id`, de modo que asignar mesero a una mesa violaba la llave foránea y fallaba siempre.
- El rol `WAITER` sigue existiendo y es para lo otro: darle acceso a la aplicación al mesero que sí lo necesita.

## D-047 — El rol de mesero incluye `sales:create`
- `WAITER` recibe `sales:create`, `sales:view`, `products:view`, `customers:view`, `customers:create`, `branches:view` y `terminals:view`. Nada de caja, catálogo, usuarios ni anulaciones.
- **Motivo:** las pantallas de Mesas y POS del frontend se habilitan con `sales:create`; sin él, una cuenta de mesero no ve absolutamente nada y es inservible. Si un negocio no quiere que sus meseros cobren, la vía correcta es no abrirles turno de caja, no recortar este permiso.

## D-048 — Los errores de validación responden 400 con el campo que falla
- El manejador de errores trata `hasZodFastifySchemaValidationErrors` (400 con `details.issues`) e `isResponseSerializationError` (500, con el detalle solo en el log).
- **Motivo:** el error que produce Fastify a partir del esquema Zod de una ruta **no** es un `ZodError`, así que caía hasta el 500 genérico: *toda* petición mal formada del cliente respondía «Ocurrió un error interno» con `details: null`. El servidor se culpaba a sí mismo del error del cliente y no decía qué campo estaba mal — que es exactamente por qué el fallo de creación de meseros fue tan difícil de ver desde la interfaz.

## D-049 — El token de sesión por la URL solo en streams SSE
- `authenticate` acepta `?token=` únicamente en peticiones GET cuyo camino termina en `/stream`. El serializador de peticiones del log reemplaza ese valor por `[REDACTED]`.
- **Motivo:** `EventSource` no permite cabeceras propias, así que los streams no tienen alternativa. Pero la puerta estaba abierta en *todas* las rutas, y un JWT en la query queda escrito en los registros de los proxys, en el historial del navegador y en la cabecera `Referer` hacia terceros. El handshake de Socket.io ya usaba `auth.token`, que es lo correcto.

## D-050 — `/metrics` cerrado en producción, y con 404
- Fuera de producción queda abierto. En producción exige `METRICS_TOKEN` (comparación en tiempo constante); si la variable no está configurada, el endpoint responde **404**, no 401.
- **Motivo:** las métricas de Prometheus exponen rutas, latencias y volumen por endpoint — reconocimiento gratuito, y una fuga de información de negocio (cuántas ventas por minuto tiene la plataforma). El 404 evita además confirmar que el endpoint existe.

## D-051 — El migrador no importa la configuración de la aplicación
- `migrate.ts` construye su propia conexión desde `ADMIN_DATABASE_URL`/`DATABASE_URL` en vez de usar `app/env.ts`.
- **Motivo:** el esquema de entorno de la API valida toda la configuración de la aplicación —clave de Resend, proveedor DIAN, orígenes de CORS— y en producción hace fallar el arranque si falta cualquiera. Migrar no necesita nada de eso, y exigirlo obliga a repartir secretos no relacionados a un contenedor efímero que solo toca el esquema. Se comprueba en CI porque ninguna prueba ejerce el entrypoint compilado.

## D-052 — Cierre ordenado con plazo y salida forzada
- La API atiende `SIGTERM`/`SIGINT`: limpia los temporizadores, llama a `app.close()` (que drena las peticiones en vuelo y dispara el hook `onClose`) y sale con 0. Si el drenaje excede `SHUTDOWN_TIMEOUT_MS` (25 s por defecto), registra el hecho y sale con 1.
- **Motivo:** sin esto, cada despliegue cortaba peticiones a medio procesar —incluido un `POST /sales` a medio confirmar— y el `setInterval` de métricas mantenía el proceso vivo. El plazo va por debajo de los 30 s que espera un orquestador antes del SIGKILL: un proceso que no muere es peor que uno que corta, porque acaba muriendo igual sin cerrar nada.

## D-053 — Sin CSP en la API, con HSTS y `no-referrer`
- `@fastify/helmet` con `contentSecurityPolicy: false`, `crossOriginResourcePolicy: false`, HSTS solo en producción y `referrerPolicy: no-referrer`.
- **Motivo:** la API sirve JSON y la documentación de Swagger, no el HTML de la aplicación —la PWA se despliega aparte—, así que una CSP restrictiva rompería `/docs` sin proteger nada que importe. `crossOriginResourcePolicy` en `same-origin` bloquearía a la PWA, que vive en otro origen; el control real de quién puede llamar a la API es CORS.

## D-054 — `JWT_SECRET` se valida por variedad, no solo por longitud
- En producción se rechaza el secreto si parece un marcador de posición (`replace`, `change`, `example`, `default`, …) o si tiene menos de 16 caracteres distintos.
- **Motivo:** el `min(32)` que ya existía lo cumple el propio valor de ejemplo del repositorio, que conoce cualquiera que haya visto el proyecto. Firmar con él las sesiones de todos los comercios equivale a no firmarlas.

## D-055 — La barrera de errores dice el estado de la cola offline
- `ErrorBoundary` envuelve la aplicación entera y, por separado, cada pantalla (con `key={activeRoute}`). Al fallar, consulta `getPendingSalesCount()` y muestra cuántas ventas quedan guardadas en el dispositivo, pidiendo explícitamente no cerrar sesión.
- **Motivo:** la reacción natural de un cajero ante una pantalla en blanco es recargar, cerrar sesión o reinstalar la app; cerrar sesión sí puede costarle la cola de IndexedDB. El mensaje que evita esa pérdida vale más que el mensaje de error en sí. La barrera por pantalla evita además que un fallo en Reportes tumbe el POS.

## D-056 — El número fiscal lo autoriza una resolución, no el contador interno
- `dian_resolutions` guarda prefijo, rango, vigencia y consecutivo por comercio. El payload al PAC lleva `numbering` con el prefijo y el número; el proveedor HTTP **rechaza el envío si falta**.
- **Motivo:** lo que se enviaba como número de documento era `sales.sale_number`, el contador interno del comercio. En Colombia la DIAN autoriza una resolución con prefijo y rango, y el CUFE/CUDE se calcula sobre un número de ese rango. Enviar otro significa que el PAC rechaza los documentos o —peor— los acepta, y el hueco aparece meses después en una revisión, cuando ya no hay forma de reconstruir la numeración.

## D-057 — El consecutivo se asigna al emitir, no al crear la venta
- `assignDocumentNumber` reserva el número dentro de la transacción de emisión, lo persiste en `dian_documents` y lo reutiliza en los reintentos.
- **Motivo:** una venta que nunca llega a emitirse —anulada antes de que el worker la procese— no debe quemar un número, porque un hueco en la numeración hay que justificarlo ante la DIAN. Y si cada reintento pidiera un número nuevo, un PAC lento generaría una ristra de números quemados.
- La reserva es un `UPDATE … RETURNING` sobre la fila de la resolución: toma un lock de fila hasta el commit, así que dos workers concurrentes se serializan solos. **No se usa una secuencia de Postgres a propósito**: las secuencias no retroceden en un rollback, que es exactamente lo que aquí no se puede permitir. Verificado con 12 asignaciones concurrentes.
- `uq_dian_documents_fiscal_number` (único por comercio, prefijo y número) es la última red: un duplicado choca contra el índice en vez de llegar a la DIAN.

## D-058 — Una sola resolución activa por alcance
- Índice único parcial sobre `(tenant_id, document_type, branch_id)` con `WHERE is_active`. Cargar una resolución nueva desactiva la anterior del mismo alcance.
- **Motivo:** dos resoluciones activas producirían dos series de numeración en paralelo sobre el mismo comercio. Es el desastre que todo lo anterior existe para evitar.

## D-059 — El aviso de rango llega antes, no el día que se acaba
- Cada resolución tiene `alert_threshold`; al bajar de ahí, o a menos de 30 días de vencer, se publica `dian_resolution.alert` en la bandeja de salida, deduplicado por día. El endpoint expone además un campo `health` (`OK`, `LOW_RANGE`, `EXPIRING`, `EXHAUSTED`, `EXPIRED`).
- **Motivo:** agotar el rango o vencer la resolución deja al comercio sin poder facturar, de golpe, y conseguir una nueva ante la DIAN toma días. Enterarse el viernes por la tarde no sirve de nada.

## D-060 — Los documentos en `SENT` se resuelven preguntando, no reemitiendo
- `dian-sent-recheck.scheduler.ts` llama a `queryStatus` del proveedor y aplica el desenlace. `UNKNOWN` deja el documento como está.
- **Motivo:** el scheduler anterior reencolaba el evento para *reemitir*, y la guarda de idempotencia del procesador (`getDianEmissionBlockReason`) descartaba el trabajo de inmediato con «document already emitted». El documento seguía en `SENT` indefinidamente y cada ciclo dejaba una fila más en `outbox_events`: un bucle que no cerraba nada y acumulaba basura. Reemitir, además, es justo lo que no se debe hacer — el PAC podría aceptar dos veces el mismo documento.
- `UNKNOWN` significa «el proveedor no supo decirlo ahora», no un rechazo: inventar un desenlace ahí sería marcar como rechazada una factura que la DIAN podría haber aceptado.

## D-061 — El webhook del PAC va firmado y con el comercio en la ruta
- `POST /api/v1/webhooks/dian/:tenantId/status`, con HMAC-SHA256 sobre el cuerpo crudo en `x-dian-signature`, comparado en tiempo constante. Sin `DIAN_WEBHOOK_SECRET` el endpoint responde 401.
- **Motivo del comercio en la ruta:** una petición del PAC no trae sesión, y la API se conecta con un rol sin `BYPASSRLS`. Sin contexto de comercio la consulta a `dian_documents` devolvería cero filas y el webhook no encontraría nada nunca. Con el comercio en la ruta, el RLS además impide que una notificación dirigida a un comercio toque los documentos de otro.
- Responde 200 salvo firma inválida: un 500 provocaría reintentos en bucle del PAC por un documento que quizá ya no existe. Un documento ya resuelto no se reabre.
- Las dos vías conviven a propósito: el webhook es inmediato pero puede perderse; la consulta es más lenta pero siempre funciona.

## D-062 — Un domicilio se factura explícitamente, no al marcarlo entregado
- `POST /branches/:branchId/deliveries/:id/invoice` recibe turno de caja y medios de pago, crea la venta reutilizando `createSaleService` y vincula `deliveries.sale_id`.
- **Motivo:** el módulo de domicilios llegaba hasta ENTREGADO y ahí se acababa — nada creaba la venta, así que **el pedido se cobraba y no se facturaba**. No se factura automáticamente porque una venta necesita turno de caja y medio de pago, y ninguno se puede adivinar: el repartidor pudo cobrar en efectivo, con datáfono, o el cliente pudo pagar por adelantado.
- La idempotencia usa un `client_uuid` determinista derivado del id del domicilio, de modo que un doble clic o un reintento de red devuelven la misma venta. Un domicilio con dos facturas solo se arregla con nota crédito.
- Los precios y los impuestos los recalcula el servidor desde el catálogo: `deliveries.total_cents` es informativo y no se usa como base gravable (D-039).

## D-063 — Los efectos secundarios del worker respetan los tipos de auditoría y no bloquean la emisión fiscal
- En `apps/worker/src/jobs/outbox-sale-created.processor.ts`, la consulta y la inserción sobre `audit_logs` omiten el cast `::uuid` sobre `entity_id` y aprovechan el índice compuesto `(tenant_id, entity_type, entity_id)`.
- Si los efectos secundarios asíncronos (actualización de comandas en cocina o registro de auditoría) arrojan una excepción, se captura y se registra con `logWorkerError({ event: 'sale_side_effects_failed' })`, pero **no se re-lanza el error**; el job continúa hacia el paso 2 (emisión DIAN).
- **Motivo:** `audit_logs.entity_id` es de tipo `TEXT` (diseño polimórfico). En PostgreSQL no existe el operador `text = uuid`, por lo que forzar `$1::uuid` provocaba un fallo inmediato en tiempo de ejecución (`operator does not exist: text = uuid`) en cada venta procesada. Al relanzar el error, BullMQ abortaba el job antes del paso 2 y entraba en un bucle de reintentos infinitos, bloqueando por completo la emisión de facturas electrónicas a la DIAN por un fallo en una tarea secundaria.
