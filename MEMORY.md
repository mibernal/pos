# Memoria a Largo Plazo del POS DIAN (SaaS)

Este documento centraliza las decisiones de arquitectura, lecciones aprendidas y el estado general a alto nivel del proyecto.

## Decisiones Core de Arquitectura

### 1. Multi-Tenant y Seguridad (RLS)
- Toda la data está aislada por cliente utilizando `tenant_id` y *Row-Level Security* (RLS) nativo de PostgreSQL mediante `executeAsTenant`, que fija `app.current_tenant` con `set_config(..., true)` dentro de la transacción.
- **La API se conecta con `pos_api`, un rol sin `BYPASSRLS` y sin DDL** (`DATABASE_URL`). Las migraciones y semillas usan el rol dueño (`ADMIN_DATABASE_URL`). El worker usa el dueño a propósito: sus tareas programadas recorren todos los comercios por diseño.
- Esto último es la corrección de agosto de 2026 y es *la* pieza que hace real todo lo demás: hasta entonces la API se conectaba con el dueño del esquema, que salta las políticas — el RLS estaba encendido pero era decorativo. Ver `docs/ROADMAP-PRODUCCION.md` → fase 2, y D-036…D-038.
- Todas las tablas de negocio llevan `FORCE ROW LEVEL SECURITY`. `refresh_tokens` queda fuera de RLS (D-015); las tablas de plataforma tampoco llevan política de tenant, por alcance transversal (lista explícita en D-038).
- Roles de aplicación: `PLATFORM_OWNER`/`TENANT_OWNER` (gestión cruzada), y dentro de un negocio `ADMIN`, `MANAGER`, `CASHIER`, `AUDITOR`, `WAITER`. **Todos se derivan de `USER_ROLES` en `packages/shared`**: estuvieron escritos a mano en cinco sitios y desincronizados (ver más abajo).
- Un **mesero** (fila de `waiters`) no es lo mismo que un **usuario con rol `WAITER`**: lo primero es la plantilla que se asigna a una mesa, lo segundo una cuenta de acceso. `waiters.user_id` los vincula y es opcional (D-046).

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
- **Turbo 2 filtra el entorno.** Toda variable que un script necesite debe estar declarada en `globalEnv` de `turbo.json`, o simplemente no llega al proceso — sin error, sin advertencia. Esto tuvo consecuencias reales: `DATABASE_URL` y `ADMIN_DATABASE_URL` no llegaban a las pruebas, el código caía en sus valores por defecto, y la suite llevaba tiempo corriendo contra el rol equivocado. Cuando una prueba "no ve" la configuración, mirar aquí antes que en la prueba.
- **`fastify-plugin` no es opcional para plugins transversales.** Sin `fp()`, un plugin se registra en su propio contexto encapsulado y no afecta al resto de la app. El manejador de errores estuvo así: existía, estaba registrado, y no atendía ningún error — las respuestas salían con el formato por defecto de Fastify. Peor aún, cinco pruebas afirmaban ese formato equivocado, así que el bug estaba *cubierto por pruebas*.
- **RESTRICTIVE sin PERMISSIVE niega todo.** En PostgreSQL una política restrictiva *acota* a las permisivas; si no hay ninguna permisiva que acotar, la tabla queda vacía para todos. Seis tablas del módulo de restaurante y domicilios estuvieron así, sin que se notara porque la conexión saltaba el RLS.
- **`current_setting(clave, true)` es el modo correcto.** Devuelve `NULL` en vez de lanzar cuando la variable no está fijada, de modo que la comparación es falsa y la consulta no devuelve nada: olvidar el contexto de tenant produce una pantalla vacía, no una fuga. Y el tercer argumento `true` de `set_config` es *local a la transacción* — sin él, el valor se filtraría a la siguiente petición que reutilice esa conexión del pool.
- **Un doble de base de datos escrito a mano no prueba nada.** Varias pruebas usaban un falso Kysely que devolvía la misma respuesta a toda consulta: el cálculo que decían verificar quedaba fuera. Al reescribirlas contra PostgreSQL real aparecieron los bugs. Para lógica que toca el esquema, base real o la prueba es decorativa.
- **Un enum escrito a mano en cinco sitios se desincroniza.** Los roles vivían duplicados en el enum de Postgres, el esquema compartido, dos tipos de TypeScript y un `z.enum` de ruta. `WAITER` llegó a tres de los cinco, y el resultado fue una funcionalidad entera inalcanzable durante meses sin que nada fallara ruidosamente. Hoy todo se deriva de `USER_ROLES` y hay una prueba que lo verifica.
- **Un guard que compara números debe leer los valores antes de compararlos.** `ROLE_LEVEL[actor] <= ROLE_LEVEL[target]` con un rol desconocido da `undefined`, y toda comparación numérica con `undefined` es falsa: el guard *dejaba pasar* en vez de bloquear. Ante lo desconocido, una autorización se falla cerrada.
- **La alerta nunca debe poder tumbar la operación.** Todo efecto secundario no esencial (notificaciones, alertas, métricas) se publica **después** del commit y en su propia transacción. Meterlo dentro convierte un fallo cosmético en una venta perdida.

## Endurecimiento previo a Producción (Agosto 2026)

Auditoría del 25 de agosto y ejecución de las fases 0 a 2. Detalle completo y razonado en **`docs/ROADMAP-PRODUCCION.md`**; las decisiones, en D-036…D-044 de `docs/DECISIONS.md`.

### Lo que se cerró
- **Fase 0 — el proyecto volvió a compilar y a ser verificable.** 59 errores de `tsc` a 0; la migración 027 impedía crear la base desde cero (ningún entorno limpio era posible); el fixture e2e parcheaba el esquema con 33 `ALTER TABLE` en vez de migrarlo; el CI no ejecutaba nada real. Hoy: 90 migraciones desde cero y 222 pruebas verdes en CI con PostgreSQL y Redis reales.
- **Fase 1 — dinero e impuesto.** La alerta de bajo stock insertaba en una columna inexistente *dentro* de la transacción de inventario: un producto cruzando su mínimo tumbaba el descargo y dejaba la factura sin emitir en bucle de reintentos. Los totales fiscales se tomaban del snapshot del cliente. `cash_ledger` anotaba el total en pagos mixtos. Se podía emitir una venta ya anulada. Mock DIAN sin guarda de producción y credenciales del PAC en texto plano.
- **Fase 2 — RLS de verdad.** La API se conectaba con el dueño del esquema: el aislamiento no lo aplicaba el motor. Al cambiar a `pos_api` aparecieron 18 tablas mal protegidas (política ausente, variable equivocada, RESTRICTIVE sin permisiva). Migraciones 088 y 089.

- **Fase 3 — operabilidad.** Cierre ordenado ante `SIGTERM` con drenaje y plazo (antes cada despliegue cortaba peticiones en vuelo y el `setInterval` de métricas mantenía el proceso vivo). Migración de producción como entrypoint aparte, que ya no importa la configuración de la aplicación. `helmet`, `/metrics` autenticado, token de sesión fuera de la URL salvo en SSE, `JWT_SECRET` validado por variedad, `ErrorBoundary` que informa del estado de la cola offline, y Postgres/Redis publicados en `127.0.0.1`.

### El flujo de meseros (reportado por el negocio, corregido)
Cuatro defectos encadenados que ninguna revisión de una sola capa habría encontrado:
1. `WAITER` existía en el enum de Postgres desde la migración 066 y en el esquema compartido, pero no en el `UserRole` del API, ni en el del esquema de base, ni en el del frontend, ni en el `z.enum` de la ruta de creación de usuarios. **Crear un mesero era imposible por cualquier vía.**
2. `AssignWaiterModal` listaba *usuarios* y enviaba `users.id` a un campo que referencia `waiters.id` desde la migración 074: asignar mesero a una mesa violaba la llave foránea y fallaba siempre.
3. Los errores de validación respondían **500** con `details: null` en vez de 400 con el campo, así que el fallo era mudo desde la interfaz.
4. Con `enable_tables` activo y `enable_waiters` desactivado, no se podía abrir ninguna mesa: el modal exigía mesero sin mirar el flag.

Detalle en D-045…D-048 y en `docs/ROADMAP-PRODUCCION.md`.

### Lo que sigue abierto
Fases 4 (**certificación con el PAC real — es lo único que bloquea facturar legalmente**; cierre de documentos en `SENT`; control de resolución y consecutivo) y 5 (escala horizontal; hasta entonces el sistema es de **instancia única** y debe estar aceptado por escrito). Fuera del plan: gestión de secretos en un gestor real y rotación de las credenciales de ejemplo.

## Actualizaciones Recientes (Junio 2026)

### Sincronización Offline y Sesiones de Caja
- **Reasignación Automática de Sesiones:** Cuando el frontend empuja ventas offline guardadas en `PouchDB/LocalStorage`, si la sesión de caja original (`cash_session_id`) ya fue cerrada, el backend intercepta el error `409` buscando la sesión activa actual del usuario en la sucursal y la auto-reasigna. Esto previene pérdidas masivas de ventas que se quedaban atrapadas en el limbo offline.

### Deuda Técnica Resuelta
- **Deprecación de `tenant_modules`:** Toda la lógica de "Módulos de Tenant" fue extirpada. Ahora los flags (`enable_tips`, `enable_guests_count`, `enable_delivery`) viven directamente en la tabla `tenants`. Esto solucionó un error 500 silencioso en `create-sale.service.ts` y eliminó "Órdenes Fantasma" causadas por el validador obsoleto.

### Auditorías Críticas (A Resolver)

*Revisado el 28 de agosto de 2026.*

1. **Zustand Offline Sync Risk — SIGUE ABIERTO.** El middleware `persist` en `useCartStore` (`apps/pos-web/src/features/sales/hooks/useCartStore.ts`) no tiene `partialize`, de modo que los borradores de mesas (`tableCarts`) siguen guardándose en el LocalStorage de la tablet. Rompe la sincronización multi-mesero. **Acción:** añadir `partialize` que persista solo `cartItems` y `parkedCarts`.
2. **TableOrdersRepository — PARCIALMENTE RESUELTO.** El envío a cocina ya funciona por deltas y hay pruebas contra Postgres real que lo verifican (`table-orders.repository.test.ts`). Pero la **transferencia de ítems entre mesas** sigue haciendo `DELETE FROM table_order_items` + reinserción, y el mapa de inserción omite `notes`, `course`, `sent_to_kitchen_at` y `modifiers`: mover un plato a otra mesa borra la nota del comensal, el turno y la marca de que ya se había mandado a cocina. **Acción:** conservar esos campos en la reinserción, o migrar la transferencia a `UPDATE ... SET table_order_id`.
3. **Optimización FinOps MVP:** para lanzar con costos de ~$30/mes, apagar temporalmente el stack pesado de observabilidad (Tempo, Loki, Grafana) y usar Google Cloud Logging / Sentry hasta la fase de escalamiento.
