# Memoria a Largo Plazo del POS DIAN (SaaS)

Este documento centraliza las decisiones de arquitectura, lecciones aprendidas y el estado general a alto nivel del proyecto.

## Decisiones Core de Arquitectura

### 1. Multi-Tenant y Seguridad (RLS)
- Toda la data está aislada por cliente utilizando `tenant_id` y *Row-Level Security* (RLS) nativo de PostgreSQL mediante `executeAsTenant`. Esto previene cruce de información a nivel de base de datos.
- Roles estandarizados: `PLATFORM_OWNER`/`PLATFORM_ADMIN` (gestión cruzada), y dentro de un negocio `ADMIN`, `MANAGER`, `CASHIER`, `AUDITOR`.

### 2. Billing & Suscripciones (SaaS)
- El core de Billing soporta integración con **Wompi**, **MercadoPago** y **Stripe** de forma estandarizada. 
- La arquitectura delega el tracking del ciclo de vida de la suscripción al `RenewalEngine`, el cual revisa diariamente a través de jobs los trials expirados, reintentos de pago (`PAST_DUE`) y las suspensiones por grace period.
- Webhooks procesan las respuestas y validan firmas criptográficas independientemente del gateway utilizado.

### 3. Observabilidad & Trazabilidad (OpenTelemetry)
- La instrumentación de telemetría es nativa (`tracing.ts`) usando `NodeSDK` y exportadores `OTLP`.
- Trazabilidad Distribuida: Usamos atributos semánticos fuertemente tipados (`SemanticAttributes`) envolviendo la lógica crítica de negocio a través de `TracerHelper.withSpan()`. 
- **Flujos Trazados:** Facturación, Webhooks, Sales (Ventas Offline/Online), Importaciones Masivas de Inventario y el motor de renovaciones.
- Stack de Monitoreo: OTel Collector, Jaeger (UI Desarrollo), Grafana Tempo (Almacenamiento) y Prometheus (Métricas de Negocio como Ventas y Latencias).

### 4. Rendimiento & Performance (Caché Redis)
- Operaciones analíticas y reportes pesados en el Backoffice del SaaS (ARR, MRR, Growth Metrics) fueron optimizados integrando un `RedisCache` explícito que implementa el patrón Cache-Aside con TTL.
- Invalidación basada en Patrones: `SCAN` + `DEL` mitiga las necesidades de tags en Redis nativo al limpiar por pre-fijos definidos (`CACHE_KEYS`).

### 5. Sistema de Notificaciones Centralizado
- Implementado con patrón Strategy en `NotificationService`. 
- Desacoplamiento de proveedores de email. Por defecto se usa **Resend** para notificaciones transaccionales (Bienvenida, Alertas de Stock, Vencimientos de suscripción y recibos).

### 6. Especialización por Vertical (Restaurantes vs Retail)
- El esquema de Tenants ahora incluye `business_type` y `enable_tables` permitiendo habilitar features específicas dinámicamente.
- **Módulo de Mesas:** Ruteo táctil inteligente por salones. Implementamos **WebSockets (Socket.io)** para sincronización de estados de mesa en tiempo real. Esto elimina la necesidad de HTTP polling, reduciendo significativamente la carga en la base de datos.
- **Módulo de Domicilios (Deliveries):** Ciclo de vida propio (Pendiente -> Preparación -> En Camino -> Entregado). La facturación fiscal se difiere hasta la entrega efectiva.

## Lecciones Aprendidas & Gotchas
- **Drift de Precios y Propinas:** Las ventas offline o con propinas manuales (`tip_cents`) pueden diferir del precio calculado en backend. Se implementaron validaciones donde el `snapshot.total_cents` enviado desde frontend *debe* incluir explícitamente el `tipCents`, de lo contrario, el backend lanza un `PRICE_DRIFT_EXCEEDED` al fallar la validación anti-tampering.
- **Temporizadores de Mesas:** En POS para restaurantes, el tiempo de ocupación visual debe guiarse por la inserción del primer ítem (`orderCreatedAt` o min `created_at` del order_item), no por el `statusUpdatedAt` de la mesa, ya que cambiar el estado a medio servicio reinicia el reloj erróneamente.
- **Fastify & Socket.io Lifecycle:** Al usar `fastify-socket.io`, el binding de eventos de WS dentro de `app.ready()` debe situarse **al final** del registro principal para evitar el crash crítico `FastifyError: Root plugin has already booted`.
- **Stock Guards:** Las validaciones de inventario negativo deben correr como último paso en el transaction de ventas para minimizar conflictos de bloqueo pesimista (Pessimistic Locking).
- **TypeScript y ESM:** Configuración en ES Modules implica el uso constante de extensiones `.js` en importaciones relativas dentro del código TypeScript para evitar errores de transpilación.

## Actualizaciones Recientes (Junio 2026)

### Sincronización Offline y Sesiones de Caja
- **Reasignación Automática de Sesiones:** Cuando el frontend empuja ventas offline guardadas en `PouchDB/LocalStorage`, si la sesión de caja original (`cash_session_id`) ya fue cerrada, el backend intercepta el error `409` buscando la sesión activa actual del usuario en la sucursal y la auto-reasigna. Esto previene pérdidas masivas de ventas que se quedaban atrapadas en el limbo offline.

### Deuda Técnica Resuelta
- **Deprecación de `tenant_modules`:** Toda la lógica de "Módulos de Tenant" fue extirpada. Ahora los flags (`enable_tips`, `enable_guests_count`, `enable_delivery`) viven directamente en la tabla `tenants`. Esto solucionó un error 500 silencioso en `create-sale.service.ts` y eliminó "Órdenes Fantasma" causadas por el validador obsoleto.

### Auditorías Críticas (A Resolver)
1. **Zustand Offline Sync Risk:** El middleware `persist` en `useCartStore` actualmente almacena los borradores de mesas (`tableCarts`) en el LocalStorage de la tablet. Esto rompe la sincronización multi-mesero en restaurantes. **Acción requerida:** Retirar `tableCarts` de `persist`.
2. **TableOrdersRepository Destructivo:** Actualizar una mesa hace un `DELETE FROM table_order_items` y reinserta todo. Esto destruye la identidad de los ítems en cocina (`sent_to_kitchen_at`) y pierde los `modifiers_json`. **Acción requerida:** Migrar a actualización por deltas.
3. **Optimización FinOps MVP:** Para lanzar a producción con costos de ~$30/mes, se recomienda apagar temporalmente el stack pesado de observabilidad (Tempo, Loki, Grafana) y usar Google Cloud Logging / Sentry hasta la fase de escalamiento.
