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
- **`fastify-plugin` no es opcional para plugins transversales.** Sin `fp()`, un plugin se registra en su propio contexto encapsulado y no afecta al resto de la app. El manejador de errores estuvo así: existía, estaba registrado, y no atendía ningún error — las respuestas salían con el formato por defecto de Fastify. Peor aún, cinco pruebas afirmaban ese formato equivocado, así que el bug estaba *cubierto por pruebas*. **Volvió a pasar con Swagger**: `registerSwagger` decoraba una instancia hija, así que `/docs` llevaba meses documentando **cero rutas** y nadie podía generar tipos de un contrato que no existía. Cuando algo transversal «está puesto y no hace nada», mirar el `fp()` antes que nada.
- **Un Redis que acepta la conexión y no responde es peor que uno caído.** Un contenedor en pausa detrás del reenvío de puertos de Docker mantenía el socket abierto sin contestar, y como el limitador de intentos corre antes que nada, `/auth/login`, `/auth/refresh` y el propio `/health` se quedaban esperando un comando que nunca volvía: sin error, sin log y sin que el health check lo delatara, porque se colgaba en el mismo `ping`. `maxRetriesPerRequest` no protege de esto —solo cuenta reintentos entre reconexiones, y no hay reconexión si el socket sigue abierto—: hace falta `commandTimeout`. Toda dependencia no esencial necesita plazo y degradación; un caché de rate limit no puede dejar a un comercio sin caja (D-068).
- **Una clave de consulta escrita a mano en dos sitios se desincroniza, igual que un enum.** Es un contrato entre quien consulta y quien invalida, y escrito mal en uno solo de los dos archivos no lo ve nadie leyendo cualquiera de ellos: `useFireKitchenCourse` invalidaba `['kitchen-tickets']` mientras el KDS lee `['kds-tickets']`, así que esa invalidación no hizo nada desde el día en que se escribió. Las claves salen de `shared/query-keys`, con el ámbito primero (D-069).
- **Un `jsonb` sale de Kysely como `unknown`, y `unknown` viaja.** `tax_lines_json` y `payment_json` llegaban así hasta el navegador, donde el frontend los trataba como tipos garantizados que nadie garantizaba. Se validan al salir del mapeador. Y no todo degrada igual: unas líneas de impuesto vacías se ven raras y se corrigen, pero para «cómo se pagó» no existe relleno honesto — ahí se revienta (D-071).
- **Declarar la respuesta de una ruta no es documentar.** Fastify serializa a través del esquema y recorta lo que no esté en él. Sin declararlo sale por el cable lo que el handler haya seleccionado de más —un `password_hash` arrastrado por un join— y ninguna prueba se entera. De 193 operaciones, 31 lo declaraban; enchufar cinco destapó siete divergencias reales entre lo prometido y lo devuelto (D-070).
- **Un hijo de grid no se encoge solo.** Nace con `min-width: auto`, así que la columna se dimensiona al contenido más ancho y arrastra el resto fuera de la ventana: el armazón se salía 203 px de un móvil de 375 con los breakpoints correctamente escritos. Se arregla con `minmax(0, 1fr)` y `min-width: 0`, pero sobre todo: **esto no se ve leyendo el CSS**, se ve midiendo el documento en un navegador (D-072).
- **RESTRICTIVE sin PERMISSIVE niega todo.** En PostgreSQL una política restrictiva *acota* a las permisivas; si no hay ninguna permisiva que acotar, la tabla queda vacía para todos. Seis tablas del módulo de restaurante y domicilios estuvieron así, sin que se notara porque la conexión saltaba el RLS.
- **`current_setting(clave, true)` es el modo correcto.** Devuelve `NULL` en vez de lanzar cuando la variable no está fijada, de modo que la comparación es falsa y la consulta no devuelve nada: olvidar el contexto de tenant produce una pantalla vacía, no una fuga. Y el tercer argumento `true` de `set_config` es *local a la transacción* — sin él, el valor se filtraría a la siguiente petición que reutilice esa conexión del pool.
- **Un doble de base de datos escrito a mano no prueba nada.** Varias pruebas usaban un falso Kysely que devolvía la misma respuesta a toda consulta: el cálculo que decían verificar quedaba fuera. Al reescribirlas contra PostgreSQL real aparecieron los bugs. Para lógica que toca el esquema, base real o la prueba es decorativa.
- **Un enum escrito a mano en cinco sitios se desincroniza.** Los roles vivían duplicados en el enum de Postgres, el esquema compartido, dos tipos de TypeScript y un `z.enum` de ruta. `WAITER` llegó a tres de los cinco, y el resultado fue una funcionalidad entera inalcanzable durante meses sin que nada fallara ruidosamente. Hoy todo se deriva de `USER_ROLES` y hay una prueba que lo verifica.
- **Un guard que compara números debe leer los valores antes de compararlos.** `ROLE_LEVEL[actor] <= ROLE_LEVEL[target]` con un rol desconocido da `undefined`, y toda comparación numérica con `undefined` es falsa: el guard *dejaba pasar* en vez de bloquear. Ante lo desconocido, una autorización se falla cerrada.
- **Un bucle de reintentos que no comprueba su efecto puede no hacer nada durante meses.** El recheck de documentos DIAN encolaba trabajo que otra guarda descartaba de inmediato: los logs decían «reencolado», las métricas subían, y ningún documento se resolvía. Cuando un mecanismo de recuperación existe, hay que probar que *recupera*, no que se ejecuta.
- **Una secuencia de Postgres no sirve para un consecutivo fiscal.** No retrocede en un rollback, así que cada transacción fallida deja un hueco — y un hueco en la numeración hay que justificarlo ante la DIAN. La reserva correcta es un `UPDATE … RETURNING` sobre una fila, que sí vuelve atrás.
- **La alerta nunca debe poder tumbar la operación.** Todo efecto secundario no esencial (notificaciones, alertas, métricas, logs de auditoría secundarios, actualización de estados de comandas) se publica o procesa de forma aislada y no debe abortar la transacción principal de emisión fiscal DIAN. Meterlo dentro o re-lanzar su error convierte un fallo cosmético en una factura bloqueada en bucle de reintentos.
- **En PostgreSQL no existe el operador `text = uuid`.** `audit_logs.entity_id` es `TEXT` (diseño polimórfico para auditar cualquier entidad). Forzar un cast como `WHERE entity_id = $1::uuid` o `VALUES (..., $4::uuid, ...)` hace que Postgres falle en tiempo de ejecución con `operator does not exist: text = uuid`. Los identificadores contra columnas `TEXT` deben enviarse como texto plano sin castear a UUID.

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

- **Fase 4 — ciclo fiscal (código).** Lo que se enviaba al PAC como número de documento era `sales.sale_number`, el contador interno del comercio: no es una factura electrónica válida. Ahora hay resoluciones con prefijo y rango, consecutivo atómico sin huecos ni duplicados (verificado con 12 workers concurrentes), y aviso antes de que el rango se agote o la resolución venza. El recheck de documentos en `SENT` **no hacía nada**: reencolaba una reemisión que la guarda de idempotencia descartaba, dejando el documento colgado y una fila más en la bandeja cada ciclo; ahora consulta al PAC, y hay webhook firmado y alerta. Y un domicilio entregado, que antes se cobraba sin facturar, ya genera su documento.

### Lo que sigue abierto
- **Certificación con un PAC real** — es lo único que bloquea facturar legalmente, y no depende del código. Guía en `docs/CERTIFICACION-PAC.md`.
- **Fase 5, escala horizontal** — hasta entonces el sistema es de **instancia única** y debe estar aceptado por escrito.
- Fuera del plan: gestión de secretos en un gestor real, rotación de las credenciales de ejemplo, y un ensayo real de restauración desde backup.

## Ruta de producto — fases 6 a 11 (cerradas el 11 de septiembre de 2026)

Continuación de `auditoria_producto_2026-08-28.md`. Relato completo en `docs/ROADMAP-PRODUCCION.md`; decisiones en D-063…D-077. Migraciones 091 a 110.

- **Fase 6 — fugas silenciosas.** Alta de comercios que devolvía 201 sin crear la suscripción, `QuotaGuard` que impedía montar el negocio durante el trial, `'CANCELED'` con una ele que dejaba las bajas fuera del churn, seis macro-módulos que valían siempre falso, webhooks que respondían 200 a todo (incluido el fallo propio, con lo que el cobro se perdía) y el PIN del mesero legible por cualquier empleado desde la pestaña de red.
- **Fase 7 — el plan gobierna el producto.** Los entitlements pasan a ser datos (`plan_entitlements`, `plan_modules` y excepciones por comercio **con motivo y caducidad**). Los 21 booleanos de `tenants` quedan como vista de compatibilidad: **si algo lee esas columnas para decidir, está leyendo una caché, no la verdad.**
- **Fase 8 — cobro recurrente.** Tokenización, motor de cobro real con `pg_advisory_xact_lock`, secuencia de cobranza escrita (aviso, cobro, reintentos, gracia, degradación, suspensión) y portal del comercio. La caja nunca se apaga.
- **Fase 9 — la caja completa.** Los pagos dejan de vivir dentro de un blob y pasan a ser filas (`sale_payments`): el arqueo y el Z son un `GROUP BY` en vez de quince rutas posibles dentro de un JSON. El medio de pago es un comportamiento —en el cajón, cobrado electrónicamente, o sin entrada de dinero—, y el fiado es una cuenta por cobrar con cupo comprobado bajo lock.
- **Fase 10 — el restaurante.** Recetas y escandallo (lo vendido se convierte en ingredientes consumidos antes de tocar los balances), identidad única del mesero con turnos reales, cuatro informes de operación y pedido desde el menú QR. **El QR no cobra:** el comensal pide y pide la cuenta, el cobro sigue en la caja.
- **Fase 11 — el frontend.** Enrutador real con URL por pantalla y la guarda en la definición de la ruta, React Query en las 34 pantallas con las claves en una fábrica, contrato del API publicándose de verdad, e2e del camino del dinero en CI y el armazón capaz de encogerse hasta 375 px.

### Lo que sigue pendiente (11 de septiembre de 2026)

- **Seguridad.** CORS acepta peticiones sin cabecera `Origin`. `ADMIN` y `TENANT_OWNER` se saltan la verificación de permisos.
- **`sale_items` no guarda el nombre del producto**, solo `product_id`: renombrar un producto reescribe el nombre impreso en el tiquete de una venta vieja. Para un documento fiscal eso no debería poder pasar — pide columna nueva y migración.
- **Multi-instancia.** Sin `@socket.io/redis-adapter`, con más de una instancia de API las mesas y el KDS quedan desincronizados entre cajas. Sigue siendo la razón principal de la instancia única.
- **El prorrateo del cambio de plan** se calcula en `/plan/preview` y `ChangeTenantPlanUseCase` no lo aplica: lo que el comercio ve antes de aceptar no es lo que se le cobra.
- **La cadena del contrato no la consume nadie.** `contract.ts` no lo importa ningún archivo y `client.ts` sigue con 38 tipos a mano; CI vigila una generación que nadie usa. Trece archivos del frontend siguen con `fetch` crudo (SSE y pantallas públicas, en dos estilos distintos).
- **`ScannerReconciliationScreen` es una maqueta**: `useQuery`, `useMutation` y el cliente del API están simulados dentro del propio archivo y ninguna ruta la pinta. O se termina o se borra.
- **No existen todavía** (es la fase 12): compras y proveedores —solo las tablas—, fidelización —solo la bandera `enable_loyalty`—, promociones v2 (combos, happy hour, por categoría), API pública con llaves por comercio y webhooks salientes, roles a medida, e integración de datáfono: `sendToPaymentTerminal` en `hardware.ts` es un simulador con `Math.random()`.

### Repaso de responsive y UX (11 de septiembre, después de cerrar la fase 11)

Decisiones D-073…D-077. Lo importante para quien venga después no son los arreglos, sino **por
qué ninguna prueba los vio**:

- La prueba de anchos navegaba con `page.goto`. Recarga, el contexto de caja vive en memoria, y
  cada recarga volvía a «Selecciona una Sucursal»: medía siete veces la pantalla de apertura
  creyendo medir siete pantallas. **Una prueba que no prueba y da verde es peor que no tenerla.**
  Ahora navega pulsando, cobra una venta antes de mirar el historial (vacío cabe en cualquier
  ancho) y mide la caja de cada control contra la ventana, no el ancho del documento.
- **`overflow: hidden` sobre contenido más alto que su caja no recorta: borra.** En un teléfono
  la lista de ventas recibía 34 px para 676 px de contenido y el catálogo del POS 257 para 681.
  No se veía ni una venta ni un producto. Regla: si un panel tiene el alto impuesto, su
  contenido se desplaza.
- **`display: flex` en un atributo `style` pisa la hoja de estilos por especificidad.** Ese fue
  el defecto del historial, y quedan ~75 filas escritas así: la próxima aparecerá igual de
  callada.
- **Un `as` no valida, solo calla al compilador.** Reportes enseñaba «$ NaN» porque la ruta
  serializaba y `writeEvent` volvía a serializar; el `as DashboardStats` del cliente y el `any`
  del servidor se taparon el uno al otro. Nada falló: 200, `data:` bien formado y `{stats && …}`
  en verde porque una cadena no vacía es *truthy*.
- **`CORS_ALLOWED_ORIGINS` tiene que incluir `http://localhost:4173`**, el `vite preview` sobre
  el que corren las e2e. Si falta, el navegador se queda en «Selecciona una Sucursal» y el error
  no menciona CORS por ningún lado.

Verificación al cierre: typecheck 6/6, **402 pruebas** (269 API + 1 omitida, 64 worker, 44
pos-web, 25 shared), lint sin errores, e2e de anchos en verde a 375 / 768 / 1024 / 1280 / 1440
sobre seis pantallas, y revisión visual de las capturas (`apps/pos-web/e2e/capturas.mjs`).

## Actualizaciones Recientes (Junio 2026)

### Sincronización Offline y Sesiones de Caja
- **Reasignación Automática de Sesiones:** Cuando el frontend empuja ventas offline guardadas en `PouchDB/LocalStorage`, si la sesión de caja original (`cash_session_id`) ya fue cerrada, el backend intercepta el error `409` buscando la sesión activa actual del usuario en la sucursal y la auto-reasigna. Esto previene pérdidas masivas de ventas que se quedaban atrapadas en el limbo offline.

### Deuda Técnica Resuelta
- **Deprecación de `tenant_modules`:** Toda la lógica de "Módulos de Tenant" fue extirpada. Ahora los flags (`enable_tips`, `enable_guests_count`, `enable_delivery`) viven directamente en la tabla `tenants`. Esto solucionó un error 500 silencioso en `create-sale.service.ts` y eliminó "Órdenes Fantasma" causadas por el validador obsoleto.

### Auditorías Críticas (A Resolver)

*Revisado el 28 de agosto de 2026; re-verificado el 11 de septiembre. Los dos primeros siguen abiertos exactamente igual — ninguna de las fases 6 a 11 los tocó.*

1. **Zustand Offline Sync Risk — SIGUE ABIERTO.** El middleware `persist` en `useCartStore` (`apps/pos-web/src/features/sales/hooks/useCartStore.ts`) no tiene `partialize`, de modo que los borradores de mesas (`tableCarts`) siguen guardándose en el LocalStorage de la tablet. Rompe la sincronización multi-mesero. **Acción:** añadir `partialize` que persista solo `cartItems` y `parkedCarts`.
2. **TableOrdersRepository — PARCIALMENTE RESUELTO.** El envío a cocina ya funciona por deltas y hay pruebas contra Postgres real que lo verifican (`table-orders.repository.test.ts`). Pero la **transferencia de ítems entre mesas** sigue haciendo `DELETE FROM table_order_items` + reinserción, y el mapa de inserción omite `notes`, `course`, `sent_to_kitchen_at` y `modifiers`: mover un plato a otra mesa borra la nota del comensal, el turno y la marca de que ya se había mandado a cocina. **Acción:** conservar esos campos en la reinserción, o migrar la transferencia a `UPDATE ... SET table_order_id`.
3. **Optimización FinOps MVP:** para lanzar con costos de ~$30/mes, apagar temporalmente el stack pesado de observabilidad (Tempo, Loki, Grafana) y usar Google Cloud Logging / Sentry hasta la fase de escalamiento.
