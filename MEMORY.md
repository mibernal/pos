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

## Lecciones Aprendidas & Gotchas
- **Drift de Precios:** Ventas hechas desde IndexedDB offline pueden diferir del precio online. Implementamos validaciones que avisan si la diferencia supera el 10% y el backend corrige sutilmente el descuento para que el monto de la transacción (`total_cents`) coincida exactamente con lo ingresado a caja.
- **Stock Guards:** Las validaciones de inventario negativo deben correr como último paso en el transaction de ventas para minimizar conflictos de bloqueo pesimista (Pessimistic Locking).
- **TypeScript y ESM:** Configuración en ES Modules implica el uso constante de extensiones `.js` en importaciones relativas dentro del código TypeScript para evitar errores de transpilación.
