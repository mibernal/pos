# Ruta a Producción

Estado al **28 de agosto de 2026** (fases 0–4 cerradas en su parte de código). Este documento es el registro vivo del endurecimiento previo a producción: qué se cerró, con qué evidencia, y qué falta.

Punto de partida: auditoría sobre `main` del 25 de agosto de 2026. El sistema era funcionalmente rico y estaba operativamente roto — no compilaba, la base no se podía crear desde cero, y el CI llevaba meses sin ejecutar nada real. Nada de lo que sigue es opinión de diseño: son fallos que se reprodujeron y se corrigieron con una prueba que los cubre.

**El orden de las fases no es negociable.** Cada una depende de que la anterior sea verificable. La fase 2 en particular no se puede intentar sin la 0: sin una suite corriendo contra migraciones reales no hay forma de saber si el cambio de rol rompió algo.

---

## Estado por fase

| Fase | Qué resuelve | Estado |
|---|---|---|
| 0 | Volver a compilar y a confiar en el CI | ✅ Completada — 28 ago 2026 |
| 1 | Blindar el dinero y el impuesto | ✅ Completada — 28 ago 2026 |
| 2 | Recuperar RLS de verdad | ✅ Completada — 28 ago 2026 |
| 3 | Hacerlo operable | ✅ Completada — 28 ago 2026 |
| 4 | Cerrar el ciclo fiscal con el PAC real | ✅ Código completo — 28 ago 2026 · ⏳ falta la certificación con el PAC |
| 5 | Escala horizontal | ⏳ Diferible hasta ~20 clientes |
| 6 | Cerrar las fugas silenciosas (producto) | ✅ Completada — 30 ago 2026 |
| 7 | Que el plan gobierne el producto | ✅ Completada — 30 ago 2026 |
| 8 | Cobro recurrente que ocurre solo | ✅ Completada — 3 sep 2026 |

---

## Fase 0 — Volver a compilar y a confiar en el CI ✅

**El problema.** `pnpm typecheck` arrojaba 59 errores. La base de datos no se podía crear desde cero: la migración 027 fallaba con `relation "uq_audit_logs_tenant_id_pair" already exists`, de modo que ningún desarrollador ni ningún CI podía levantar un entorno limpio. Los tests "e2e" corrían contra un esquema parcheado a mano con 33 `ALTER TABLE` en el fixture, lo que quiere decir que probaban una base que no existe en ningún despliegue real.

**Lo que se hizo.**

- 59 errores de `tsc` → 0. De esos, 42 venían de un `packages/shared/dist` obsoleto (está en `.gitignore`, y `tsconfig.build.json` lo resolvía por paths): el síntoma engañaba, el problema real eran 17.
- Se añadió el `exports` map a `packages/shared/package.json` para que los imports por subpath resolvieran en tiempo de ejecución, y un alias por regex en los tres `vitest.config.ts`.
- **Migración 027 arreglada**: se renombra la constraint de `audit_logs_old` antes de crear la tabla nueva. Sin esto no hay entorno limpio posible.
- `turbo.json`: `typecheck.dependsOn = ["^build"]`.
- `.github/workflows/ci.yml` reescrito con servicios `postgres:16` y `redis:7`, migración antes de los tests, y `lint` + `typecheck` + `build` + `test` en cada PR.
- Bucle infinito en `TenantModuleDependencyResolver` (colgaba vitest más de 5 minutos): resuelto con un `Set` de cascada y una guarda de pases máximos.
- Reescritura de las pruebas fiscales contra PostgreSQL real: el doble de Kysely escrito a mano devolvía la misma respuesta a toda consulta, así que no probaba el cálculo.
- `errorHandlerPlugin` envuelto en `fastify-plugin`. Sin `fp()` el manejador quedaba encapsulado en su propio contexto y no atendía los errores del resto de la app: las respuestas de error salían con el formato por defecto de Fastify en vez del contrato `{ error: { code, message, details } }`. Cinco pruebas afirmaban el formato equivocado.

**Criterio de salida — cumplido.** `pnpm lint && pnpm typecheck && pnpm build && pnpm test` en verde sobre un clon limpio, con el esquema construido desde cero.

---

## Fase 1 — Blindar el dinero y el impuesto ✅

Cinco defectos, todos con dinero o con la DIAN de por medio.

### 1. La alerta de stock tumbaba la venta

El `INSERT` de la alerta de bajo stock escribía en una columna `event_type` que no existe en ninguna migración, y ocurría **dentro** de la misma transacción que descarga el inventario. Cuando un producto cruzaba su mínimo, la transacción reventaba: el inventario no se descargaba, la factura de esa venta nunca se emitía, y el evento quedaba reintentándose en bucle. Un producto popular con mínimo configurado bastaba para dejar de facturar.

Corregido: columna `type`, valor `low_stock.alert`, `product_name` en el payload, y la alerta se acumula durante la transacción pero se publica **después del commit**, en su propia transacción. Una alerta nunca debe poder tumbar una venta. Prueba de regresión en `apps/worker/test/`.

### 2. Los totales fiscales venían del cliente

`create-sale.service.ts` sobrescribía los totales calculados por el servidor con los del snapshot enviado por el frontend. Un cliente modificado podía fijar la base gravable de una factura electrónica.

Ahora los `final*` son `const` y provienen exclusivamente del servidor. El snapshot se compara y, si difiere, la diferencia se registra en `audit_payload.snapshot_discrepancy` — como discrepancia de caja, no como base gravable. Por encima del umbral se rechaza la venta.

### 3. `cash_ledger` registraba el total, no el efectivo

En un pago mixto (efectivo + tarjeta) el libro de caja anotaba el importe completo. **Aclaración importante**: esto *no* afectaba el arqueo — `calculateExpectedCashCents` deriva de `payment_json` vía `extractCashPaidCents`, no del ledger. El defecto estaba en el libro inmutable de auditoría, que es donde uno acude precisamente cuando el arqueo no cuadra. Ahora escribe solo `normalizedPayments.amounts.cash_cents`, y solo si es mayor que cero.

### 4. Se podía emitir la factura de una venta ya anulada

Entre que la venta entra al outbox y que el worker la procesa, la venta puede anularse. No había guarda. Ahora el procesador consulta `SELECT status FROM sales` antes de emitir; si es `VOID`, marca el evento como enviado con razón `SALE_VOIDED_BEFORE_EMISSION` y no emite.

### 5. Mock DIAN y credenciales en texto plano

- `assertMockAllowed()` en `apps/worker/src/providers/index.ts` lanza si `NODE_ENV=production` y el proveedor es `MOCK`, o si el proveedor es desconocido, o si falta configuración. Un worker productivo en modo mock devuelve CUDEs inventados y nadie se entera hasta que llega la DIAN.
- `tenant_dian_settings.credentials` se cifra con AES-256-GCM (`packages/shared/src/crypto/secret-box.ts`, deliberadamente **no** exportado desde el índice para que no entre al bundle del navegador). `resolveDianCredentials()` lanza si encuentra texto plano en producción. Script de migración: `pnpm --filter @pos-dian/worker encrypt-credentials`.

**Criterio de salida — cumplido.** Ninguna venta puede quedar sin documento por una alerta, y ningún valor fiscal proviene del cliente. Hay una prueba por caso.

---

## Fase 2 — Recuperar RLS de verdad ✅

La fase con más riesgo del plan, y la que más deuda oculta destapó.

**El problema.** El RLS estaba habilitado, las políticas escritas, `executeAsTenant` en uso… y la API se conectaba con el **dueño del esquema**, que salta todas las políticas por definición. El aislamiento entre comercios no lo aplicaba PostgreSQL: lo aplicaba la disciplina de quien escribía cada consulta. Tres de las pruebas de aislamiento estaban marcadas `skip` justamente porque el rol las hacía pasar sin comprobar nada.

**Lo que apareció al preparar el cambio de rol.** Tres clases de defecto que habrían apagado el sistema de golpe:

1. **Variable equivocada** — `order_rounds` y `tenant_dian_settings` comparaban contra `app.current_tenant_id`, que nadie fija (el resto del esquema usa `app.current_tenant`). Con RLS real: rondas de cocina en blanco y, peor, **ninguna credencial del PAC legible, es decir, ninguna factura emitida**.
2. **RESTRICTIVE sin permisiva** — seis tablas de restaurante y domicilios (`deliveries`, `delivery_items`, `delivery_persons`, `waiters`, `kitchen_tickets`, `kitchen_ticket_items`). En PostgreSQL una política restrictiva *acota* a las permisivas; sin ninguna permisiva que acotar, niega todo. Domicilios, meseros y cocina se habrían apagado por completo.
3. **Sin RLS en absoluto** — diez tablas con `tenant_id`: `branches`, `rooms`, `tables`, `reservations`, `suppliers`, `product_images`, `product_modifier_groups`, `product_modifier_options`, `bulk_import_jobs` y `audit_logs_default` (la política del padre particionado no cubre el acceso directo a la partición).

**Lo que se hizo.**

- **Migración `088_rls_consistency`** — aplica una política PERMISSIVE uniforme con `app.current_tenant` a las 18 tablas afectadas, y `FORCE ROW LEVEL SECURITY` a esas más `table_orders`, `table_order_items`, `order_rounds` y `tenant_dian_settings`. El `down()` no restaura las políticas incorrectas a propósito: volver a ellas dejaría el esquema roto.
- **Migración `089_api_role_grants`** — refresca los `GRANT` de `api_user` sobre las tablas creadas después de la 057, más `ALTER DEFAULT PRIVILEGES`. No concede DDL.
- **`infra/scripts/create-api-role.sh`** — crea `pos_api` `IN ROLE api_user` e imprime `rolbypassrls` para verificación inmediata. Se ejecuta **después** de migrar.
- **Modelo de dos conexiones** — `DATABASE_URL` (rol `pos_api`, la API) y `ADMIN_DATABASE_URL` (dueño, migraciones y semillas). El worker sigue con el rol dueño: sus tareas programadas recorren todos los comercios por diseño.
- **`ensureE2eSchema()` ya no parchea el esquema** — los 33 `ALTER TABLE` del fixture desaparecieron; ahora solo verifica que `kysely_migration` tenga filas. Si el esquema no está migrado, las pruebas fallan en vez de inventarse una base.
- **`rls.spec.ts` reescrito** — seis pruebas, ninguna `skip`: lectura sin contexto (debe devolver cero filas), lectura propia, lectura cruzada por id, `UPDATE`/`DELETE` ajenos, `INSERT` a nombre de otro tenant, y `COUNT(*)` sin `WHERE`. Un `beforeAll` consulta `pg_roles` y **aborta la suite** si el rol tiene `BYPASSRLS`.
- **Bug real encontrado por el cambio**: el login llamaba a `getUserBranchIds` fuera de contexto de tenant. Con RLS real devolvía cero sucursales. Ahora va envuelto en `executeAsTenant`.

**El hallazgo que casi se nos escapa.** Trece suites del API empezaron a fallar con "la base de pruebas no tiene el esquema migrado" pese a estar migrada. Causa: **Turbo 2 filtra las variables de entorno por defecto**. `DATABASE_URL` y `ADMIN_DATABASE_URL` nunca llegaban a los scripts de prueba y el código caía en sus valores por defecto —el rol dueño— sin decir una palabra. Es decir: *las pruebas llevaban tiempo corriendo contra el rol equivocado*. Se corrigió declarando `globalEnv` en `turbo.json`. Cualquier variable nueva que las pruebas necesiten hay que declararla ahí o simplemente no existe.

**Criterio de salida — cumplido.** La API corre sin `BYPASSRLS`, la suite pasa entera (222 pruebas), y quitar `executeAsTenant` de una ruta rompe una prueba.

---

## Fase 3 — Hacerlo operable ✅

- **Apagado ordenado** (`apps/api/src/index.ts`): `SIGTERM`/`SIGINT` limpian los temporizadores, llaman a `app.close()` —que deja de aceptar conexiones, drena las peticiones en vuelo y dispara el hook `onClose`: cola de BullMQ, Redis y pool de Postgres— y salen con 0. Si el drenaje excede `SHUTDOWN_TIMEOUT_MS` (25 s), se registra y se sale con 1: un proceso que no muere acaba recibiendo SIGKILL igual, pero sin cerrar nada. Verificado con un SIGTERM real contra el binario compilado.
- **Ruta de migración en producción**: `pnpm --filter @pos-dian/api db:migrate:prod` → `node dist/shared/infra/db/migrate.js`. El migrador **ya no importa `app/env.ts`** (D-051): validaba toda la configuración de la aplicación y obligaba a repartir la clave de Resend y el proveedor DIAN a un contenedor que solo toca el esquema. CI ejerce el entrypoint compilado, porque ninguna prueba lo hace.
- **`@fastify/helmet`** con CSP desactivada a propósito (D-053), HSTS en producción y `referrer-policy: no-referrer`.
- **`/metrics` cerrado** en producción tras `METRICS_TOKEN`, con comparación en tiempo constante; sin token configurado responde 404 en vez de 401 (D-050).
- **Token de sesión fuera de la URL** salvo en streams SSE, donde `EventSource` no deja alternativa; y redactado en los logs (D-049). El handshake de Socket.io ya usaba `auth.token`.
- **`JWT_SECRET` validado por variedad**, no solo por longitud: se rechazan los marcadores de posición y los secretos de menos de 16 caracteres distintos (D-054).
- **`ErrorBoundary`** global y por pantalla, que al fallar dice cuántas ventas quedan en la cola del dispositivo y pide no cerrar sesión (D-055).
- **Credenciales por defecto**: `POSTGRES_PASSWORD` parametrizado, y Postgres y Redis publicados en `127.0.0.1` en vez de `0.0.0.0` — un `'5432:5432'` pelado deja la base expuesta a toda la red del equipo, que en un portátil dentro de un local es la red del comercio.

**Criterio de salida — cumplido.** Un `SIGTERM` no corta peticiones en vuelo y un servidor nuevo se migra con un solo comando documentado, sin secretos de aplicación.

**Queda fuera, para el despliegue real:** mover los secretos a un gestor (Vault / GCP Secret Manager) y rotar en los entornos reales cualquier credencial de ejemplo del repositorio. Es trabajo de infraestructura, no de código.

---

## Corrección funcional: el flujo de meseros (28 ago 2026)

Reportado por el negocio durante la fase 3: *«al crear una mesa no es posible asignar mesero, y la creación de usuario no da la opción»*. No era un defecto sino cuatro encadenados, y ninguno se veía leyendo una sola capa.

1. **`WAITER` existía en Postgres pero no en el API.** El enum `user_role_enum` lo tiene desde la migración 066 y el esquema compartido también, pero el `UserRole` del API, el del esquema de base, el del frontend y el `z.enum` de la ruta de creación de usuarios estaban escritos a mano sin él. Crear un mesero era imposible por cualquier vía. Corregido derivando todo de `USER_ROLES` (D-045), con una prueba que falla si un rol se queda sin permisos o sin nivel de jerarquía.
2. **Dos nociones incompatibles de «mesero».** `AssignWaiterModal` listaba *usuarios* con rol `WAITER` o `ADMIN` y enviaba `users.id`; `OpenTableModal` listaba la tabla `waiters` y enviaba `waiters.id`. Ambos llamaban al mismo endpoint. Desde la migración 074 el campo referencia `waiters.id`, así que la primera vía violaba la llave foránea y fallaba siempre — y como ningún usuario podía tener rol `WAITER`, la lista solo mostraba administradores. Unificado sobre la tabla `waiters` (D-046).
3. **Todo error de validación respondía 500.** El error que Fastify produce desde el esquema Zod de una ruta no es un `ZodError` y caía al 500 genérico: cualquier petición mal formada devolvía «Ocurrió un error interno» con `details: null`. Por eso el síntoma era mudo desde la interfaz (D-048).
4. **Con mesas activas y meseros desactivados, no se podía abrir ninguna mesa.** El modal exigía elegir mesero siempre, sin mirar el flag del módulo. Un comercio con mesas pero sin control de meseros quedaba en punto muerto.

De paso aparecieron dos cosas más: `assertCanManageRole` fallaba **abierto** ante un rol desconocido —comparar con `undefined` siempre da falso, así que el guard dejaba pasar en vez de bloquear— y las rutas de escritura de meseros no exigían permiso alguno, de modo que cualquier cajero podía crear o desactivar meseros. Ambas corregidas.

**Lección.** El defecto vivía repartido entre el enum de Postgres, cuatro definiciones de tipo, dos componentes de React y un manejador de errores. Ninguna revisión de una sola capa lo habría encontrado; lo encontró recorrer el flujo completo contra Postgres real, que es lo mismo que pasó en las fases 0 a 2.

---

## Fase 4 — Cerrar el ciclo fiscal con el PAC real ✅ (código) / ⏳ (certificación)

Todo el trabajo de código está hecho y verificado. Lo que queda **no es deuda técnica sino dependencia de un tercero**: la certificación con el PAC, cuyos tiempos no controlamos. La guía completa —qué preguntarle al proveedor, la secuencia de conmutación, el set de pruebas de habilitación y las consultas de vigilancia— está en `docs/CERTIFICACION-PAC.md`.

### 1. La numeración fiscal no existía

Lo que se le enviaba al PAC como número de documento era `sales.sale_number`: **el contador interno del comercio**. En Colombia la DIAN autoriza una resolución con prefijo y rango numérico y una vigencia; cada factura electrónica lleva un número de ese rango, consecutivo y sin repetir, y el CUFE/CUDE se calcula sobre él. Enviar otro número significa que el PAC rechaza los documentos o —peor— los acepta, y el hueco aparece meses después en una revisión de la DIAN.

Migración `090_dian_resolutions` y `apps/worker/src/jobs/shared/fiscal-numbering.ts`:

- **El consecutivo se asigna al emitir, no al crear la venta.** Una venta anulada antes de que el worker la procese no quema un número; un hueco hay que justificarlo.
- **Se persiste en el documento y se reutiliza en los reintentos.** Un PAC lento no genera una ristra de números quemados.
- **La reserva es un `UPDATE … RETURNING` sobre la fila de la resolución**, que toma un lock hasta el commit: dos workers concurrentes se serializan solos. Deliberadamente *no* es una secuencia de Postgres — las secuencias no retroceden en un rollback, que es exactamente lo que aquí no se puede permitir. Verificado con 12 asignaciones concurrentes: 12 números únicos y consecutivos.
- **Índice único** por comercio, prefijo y número como última red.
- **Aviso antes de que sea un problema**: `alert_threshold` por resolución y aviso a 30 días de vencer. Quedarse sin rango un viernes por la tarde es un comercio que no puede facturar hasta que la DIAN autorice otro, y eso toma días.
- API: `GET/POST/PATCH /api/v1/dian/resolutions`, con un campo `health` (`OK`, `LOW_RANGE`, `EXPIRING`, `EXHAUSTED`, `EXPIRED`) y soporte para arrancar en un número intermedio al migrar un comercio desde otra herramienta.

### 2. El recheck de documentos en `SENT` no hacía nada

El scheduler encontraba los documentos atascados, encolaba un evento para **reemitir**… y la guarda de idempotencia del procesador lo descartaba de inmediato con «document already emitted». El documento seguía en `SENT` para siempre y cada ciclo dejaba una fila más en `outbox_events`. Un bucle que no cerraba nada y acumulaba basura.

Ahora **pregunta** en vez de reemitir —reemitir podría hacer que el PAC acepte dos veces el mismo documento—, y el cierre tiene dos vías que se cubren mutuamente:

- **Consulta al PAC** (`queryStatus`): siempre funciona, con latencia. `UNKNOWN` deja el documento como está: es «no sé decírtelo ahora», no un rechazo.
- **Webhook firmado** (`POST /api/v1/webhooks/dian/:tenantId/status`): inmediato, pero puede perderse. HMAC-SHA256 sobre el cuerpo crudo; el comercio va en la ruta porque una petición del PAC no trae sesión y la API corre sin `BYPASSRLS` — sin contexto de comercio la consulta devolvería cero filas.
- **Alerta** `dian_document.unresolved` pasadas `DIAN_SENT_ALERT_HOURS` (6 por defecto), deduplicada por día.

### 3. Un domicilio entregado no generaba documento fiscal

El módulo llegaba hasta ENTREGADO y ahí se acababa: nada creaba la venta, así que **el pedido se cobraba y no se facturaba**. `POST /branches/:branchId/deliveries/:id/invoice` crea la venta reutilizando `createSaleService` y vincula `deliveries.sale_id`.

No se factura automáticamente al marcar ENTREGADO porque una venta necesita turno de caja y medio de pago, y ninguno se puede adivinar. La idempotencia usa un `client_uuid` determinista derivado del id del domicilio: un doble clic devuelve la misma venta, porque un domicilio con dos facturas solo se arregla con nota crédito.

### 4. Lo que falta, y no depende de nosotros

- Certificación end-to-end contra el ambiente de pruebas del PAC.
- Producción con un comercio piloto y volumen controlado, al menos una semana.
- Un adaptador propio, si el PAC contratado no encaja con `HTTP_GENERIC` (uno o dos días de trabajo, no una reescritura).

**Criterio de salida.** Un ciclo completo verificado con la DIAN: factura aceptada con CUDE, nota crédito por anulación, y consecutivo sin huecos.

---

## Fase 6 — Cerrar las fugas silenciosas ✅

Primera fase de la ruta de producto (`auditoria_producto_2026-08-28.md`). Todos los
defectos comparten una forma: **una capa se movió y las otras se quedaron**, y ninguno
fallaba ruidosamente. Por eso llevaban meses ahí.

### Lo que se corrigió

**Alta de comercios sin suscripción.** El alta buscaba el plan por `billing_plans.name`
mientras el catálogo se identifica por `id` (`'STARTER'` / `'Plan Starter'`). El formulario
del panel arranca en `'STARTER'` y sus opciones valían `p.name`: un administrador que no
tocaba el desplegable enviaba un identificador que la consulta no encontraba, y el
`if (planRow)` se saltaba la creación de la suscripción **devolviendo 201**. Había dos
comercios así en la base de desarrollo. Ahora `resolveBillingPlan` acepta id o nombre, un
plan inválido es un 400, y los dos desplegables del panel envían el identificador.

**El trial no podía montar el negocio.** `QuotaGuard` exigía `status = 'ACTIVE'` y el
registro público crea la suscripción en `TRIAL`: durante los 14 días de prueba, crear un
cajero o una segunda sucursal respondía `403 QUOTA_EXCEEDED · «No se encontró una
suscripción activa»`. Ahora `TRIAL` y `PAST_DUE` (gracia) dan derecho, y «suscripción
inactiva» dejó de disfrazarse de «cuota agotada» — que en el cliente web abre el modal de
mejora de plan, inútil para quien está suspendido.

**Bajas que no contaba nadie.** `cancelSubscription` escribía `'CANCELED'` con una ele
mientras el tipo y las métricas consultan `'CANCELLED'`. Migración 091: normaliza el
histórico, añade el `CHECK` que lo impide, y un índice único parcial que deja **una sola
suscripción viva por comercio**. Todas las lecturas filtran por estado y ordenan: antes
`executeTakeFirst()` devolvía una fila arbitraria, incluido el `plan_id` que se firma en el
JWT.

**Seis módulos que valían siempre falso.** Los macro-módulos de la migración 086 se leían
en `buildAuthClaims` y no se seleccionaban en ninguna de las dos consultas de
autenticación. No lo notaba nadie porque ninguna ruta los exige todavía; la primera que lo
hiciera habría respondido 403 a todos los comercios. Hay una prueba que compara los claims
contra las columnas de `tenants`, columna por columna.

**Un plan anual concedía un mes.** `billing_cycle` se le pasaba a la pasarela para cobrar y
la activación sumaba 30 días fijos.

**Cobros que se perdían.** Las tres rutas de webhook respondían 200 a todo —firma inválida
incluida— «para evitar reintentos maliciosos». Eso descarta también el reintento legítimo:
un fallo nuestro procesando un pago aprobado se daba por entregado y el cobro desaparecía
sin dejar rastro. Ahora el código HTTP depende de quién falló (400 la firma, 200 lo ajeno o
ya aplicado, 500 lo nuestro), la migración 092 guarda el cuerpo crudo antes de intentar
nada, y el importe se contrasta contra la transacción: la firma prueba el origen del
mensaje, no la cifra.

**El PIN del mesero era público.** `waiters.pin` se guardaba en claro, el repositorio hacía
`selectAll()` y el esquema de respuesta lo incluía. `GET /branches/:id/waiters` está
abierta a propósito a cualquiera con el módulo activo, así que **cualquier empleado podía
leer el PIN de todos sus compañeros** desde la pestaña de red. Migración 094: Argon2 en
`pin_hash`, como `users.pin_hash` desde la 056, y hacia fuera solo `has_pin`. Los PIN
existentes hay que volver a asignarlos. De paso: dos meseros de la misma sucursal ya no
pueden compartir PIN, editar el nombre ya no lo borra, y la sucursal de la URL se valida
contra el comercio.

**El informe de meseros salía vacío.** Unía `users.id = sales.waiter_id` cuando desde la
migración 074 ese campo referencia `waiters.id`, y consultaba fuera de `executeAsTenant`,
de modo que con RLS forzado `sales` devolvía cero filas.

### Dos defectos que aparecieron al probarlo, no al leerlo

1. **El webhook de pago nunca fijaba contexto de comercio.** Con el rol real de la API —sin
   `BYPASSRLS`— la escritura de auditoría y las de la suscripción las denegaba Postgres: el
   pago quedaba cobrado y sin aplicar. Ahora va dentro de `executeAsTenant`, como el webhook
   de la DIAN. Con el rol dueño no se veía.

2. **Migración 093 — los permisos por defecto pertenecían al rol equivocado.** La 089 dejó
   configurados los `ALTER DEFAULT PRIVILEGES` y su propia nota lo dice: solo aplican a los
   objetos creados por el rol que los configuró. En la base real estaban a nombre de
   `postgres`, mientras que las migraciones corren como dueño del esquema. Es decir: **cada
   tabla nueva de cada migración futura nacía invisible para la API**. Lo destapó la tabla
   de la 092 al fallar dentro de su propio `catch`.

### Y uno que solo se veía fuera de CI

`inventory-stress.test.ts` sembraba el NIT fijo `'000000'` desde un `beforeAll` que corre
aunque sus pruebas estén saltadas. En CI pasa porque la base nace vacía; en una base de
desarrollo fallaba desde la segunda ejecución y arrastraba a toda la suite del API.

**Criterio de salida — cumplido.** Un comercio se registra, monta usuarios y sucursales
durante la prueba gratuita, paga un plan anual y recibe 365 días. El informe de meseros
muestra nombres. `GET /waiters` no contiene ningún PIN. Un webhook con firma inválida
responde 400 y queda registrado; uno que falla por nuestra causa responde 500 para que la
pasarela reintente.

Verificación: lint sin errores, typecheck 6/6, build 4/4 y **308 pruebas** (199 API, 60
worker, 31 pos-web, 18 shared) contra PostgreSQL y Redis reales. 22 de ellas nuevas, una
por defecto corregido.

**Queda pendiente, y no es código:** los dos comercios sin suscripción de la base de
desarrollo siguen sin plan asignado.

---

## Fase 7 — Que el plan gobierne el producto ✅

**El problema.** El precio y las capacidades eran dos sistemas que nadie sincronizaba. Un
plan era un registro con `price_cents` y un `features_json` de dos claves —`users` y
`branches`—, y esas eran las **únicas** cuotas que se comprobaban en todo el sistema. Los
módulos vivían en 21 columnas booleanas de `tenants` que un super-admin encendía a mano, sin
relación con lo que el comercio pagaba. Vender un plan superior era, literalmente, editar la
base de datos. Y como cada módulo nuevo exigía una columna, un claim del JWT, una rama de
`switch` y una línea de frontend, el catálogo no podía crecer sin una migración.

### Los entitlements pasan a ser datos

Migración **095**: `plan_entitlements` (siete dimensiones limitables), `plan_modules`, y dos
tablas de excepciones por comercio —módulos y límites— con **motivo y caducidad**. Un
override sin motivo es un booleano suelto con otro nombre: dentro de seis meses nadie sabe
por qué ese comercio tiene ese módulo.

**La migración no le quita nada a nadie.** Los módulos de un comercio eran per-comercio, no
per-plan, así que hay comercios con módulos que su plan no incluiría; apagárselos sería
romperles el negocio para arreglar nuestro modelo. Cada uno se convirtió en una concesión
explícita: **104 concesiones en 87 comercios**. Después de migrar, todos ven exactamente lo
mismo que antes; lo que cambia es que ahora está escrito de dónde viene cada permiso.

Migración **096**: RLS con `FORCE` en las dos tablas de excepciones, que llevan `tenant_id`.
Las de plan quedan fuera a propósito — son catálogo global, como `billing_plans`.

### Una sola fuente de verdad

`EntitlementsResolver` resuelve módulos, límites y nivel de servicio por petición, con caché
en Redis e invalidación explícita al cambiar plan, módulos u overrides. Dos consecuencias:

- **Los módulos dejan de viajar firmados en el JWT.** Encender uno surte efecto en la
  siguiente petición, sin cerrar sesión. Antes era imposible.
- **El `switch` de 21 ramas de `requireModule` desaparece.** Era una de las cuatro copias
  del mapa de módulos, y ya se había desincronizado de las columnas que decía representar
  (fase 6, PL-06).

Los claims del token se derivan de los módulos resueltos. Si salieran de las columnas, un
cambio de plan movería lo que el backend permite sin mover lo que el frontend enseña. Una
prueba nueva cazó exactamente esa deriva en `/auth/me`, que arma su DTO por su cuenta sin
pasar por `buildAuthResponse`.

### Cuotas sin carreras

`EntitlementGuard` sustituye a `QuotaGuard`. Las dimensiones vienen del catálogo —añadir una
es una fila, no un método— y el conteo se serializa con `pg_advisory_xact_lock` **dentro de
la transacción que inserta**. El guard anterior contaba fuera de ella, así que dos peticiones
simultáneas veían el mismo conteo y ambas pasaban: un plan de tres usuarios acababa con
cuatro. Hay una prueba que lo reproduce.

`monthly_sales` se mide y **no se bloquea**: cortar la facturación de un comercio a mitad de
servicio no es una decisión que un límite comercial deba tomar.

### La mora degrada, no apaga

Hasta ahora el estado de la suscripción no se miraba en ninguna petición: lo único que
bloqueaba era `tenants.status = 'SUSPENDED'`, y solo en el login. Una suscripción cancelada
hacía meses seguía operando con normalidad — no había ninguna barrera técnica entre pagar y
no pagar.

Ahora se aplica en la capa de permisos, con una sola regla y sin tocar rutas: `PAST_DUE`
apaga informes, catálogo, usuarios, sucursales, configuración y auditoría, y **deja la caja
funcionando** — vender, cobrar, abrir y cerrar turno, cocina y mesas. Apagarle el punto de
venta a quien debe dos semanas no acelera el pago: le hace perder el día y nos convierte a
nosotros en el problema.

### El cambio de plan se puede ver antes de hacerlo

`POST /platform/tenants/:id/plan/preview` responde qué módulos gana y pierde, qué límites
quedarían por debajo de lo que ya usa, y cuánto dinero implica. El cambio real **rechaza con
409** una bajada que dejaría al comercio fuera de cuota, con el detalle de qué sobra; hay que
reenviar con `force`. Antes era un `UPDATE plan_id` y el comercio quedaba permanentemente por
encima de su límite sin que nadie se enterara hasta que llamaba.

El prorrateo convierte el valor no consumido en días del plan nuevo y **no emite un cargo**:
cuando se escribió esto no había cobro recurrente y emitirlo habría sido inventar un
movimiento que nadie concilia. El `charge_cents` que devuelve es lo que la fase 8 ya sabe
cobrar.

**Criterio de salida — cumplido.** Crear un plan con sus módulos y límites, asignarlo y ver
el cambio sin que nadie cierre sesión ni se toque una migración. Bajar de plan avisa
exactamente qué queda fuera de cuota.

Verificación: lint sin errores, typecheck 6/6, build 4/4 y **317 pruebas** (208 API, 60
worker, 31 pos-web, 18 shared). 8 nuevas, entre ellas la de concurrencia y la de degradación.

**Lo que queda de la fase, y es de interfaz:** el editor de límites y módulos existe como API
(`PUT /platform/plans/:id/entitlements`) pero no tiene pantalla; el panel sigue editando
módulos comercio por comercio. Y el portal del comercio no muestra todavía su consumo contra
los límites, que ya expone `GET /platform/tenants/:id/usage`.

---

## Fase 8 — Cobro recurrente que ocurre solo ✅

**El problema.** El motor de renovación existía desde el principio y no cobraba nada. Los
cobros estaban comentados en el propio archivo:

```ts
if (sub.auto_renew && sub.payment_method_token) {
  // Intentar cobrar
  // MVP mock:
  // await chargeMethod(...)
}
```

Y `processTrialExpirations` llevaba un `// TODO: Si auto_renew es true, intentar cobrar el
primer mes`. El scheduler corría todos los días, contaba suscripciones vencidas, escribía la
cuenta en el log y no le cobraba a nadie. Un SaaS al que hay que perseguir el cobro a mano no
escala más allá de los clientes que quepan en una hoja de cálculo.

### El bloqueo que no bloqueaba

Las tres funciones del motor reclamaban trabajo con este patrón:

```ts
const pendientes = await db.transaction().execute(async (trx) =>
  trx.selectFrom('tenant_subscriptions')...forUpdate().skipLocked().execute()
);                                    // ← la transacción hace COMMIT aquí
for (const sub of pendientes) { ... } // ← y aquí ya no queda ningún lock
```

`FOR UPDATE SKIP LOCKED` reserva filas **mientras la transacción sigue abierta**. Al cerrarla
para salir del `execute`, los locks se sueltan y dos instancias del worker reclaman
exactamente las mismas suscripciones. Con los cobros comentados no se notaba. Con cobros de
verdad es cobrarle dos veces al mismo comercio, que es la clase de error del que uno se
entera por Twitter. `SU-01`

Ahora el reclamo es una lectura sin locks —solo sirve para saber a quién mirar— y la
exclusión vive dentro del cobro, en dos transacciones que toman `pg_advisory_xact_lock` sobre
la suscripción:

1. **Reservar** — dentro del lock: se confirma que sigue tocando cobrar, se emite o se
   recupera la factura del periodo, se incrementa el intento y se deja una transacción
   `PENDING`.
2. **Aplicar** — dentro del lock otra vez: se asienta el resultado.

La llamada a la pasarela va **entre** las dos, sin transacción abierta. Es deliberado:
mantener una transacción —y un lock— abiertos durante una llamada HTTP que puede colgarse es
cómo se agota un pool de conexiones un día de mucho tráfico. Lo que cubre ese hueco es la
fila `PENDING` que deja la primera fase, que cualquier otro proceso ve al tomar el lock. Hay
una prueba que lanza dos cobros simultáneos sobre la misma suscripción y comprueba que solo
uno cobra.

### Lo que hacía falta en el esquema

Cobrar de verdad necesitaba cuatro cosas que no existían (migraciones 097 y 098):

- **`tenant_payment_methods`** — el medio de pago sobrevive al checkout. Antes había una
  columna `payment_method_token` suelta que no decía de qué pasarela era, cuándo vence ni si
  sigue sirviendo. El número de la tarjeta no pasa por el servidor: lo tokeniza el navegador
  con la llave pública y lo que se guarda es la fuente de pago de Wompi.
- **`subscription_invoices`** — con consecutivo propio, IVA desglosado, líneas e histórico
  descargable. Es tabla y no `SEQUENCE` a propósito: una secuencia de Postgres no retrocede
  y deja hueco en cada transacción abortada, y un consecutivo de facturación con huecos es lo
  primero que pregunta un auditor. `SU-06`
- **`dunning_events`** — el rastro de la cobranza. Responde «¿por qué está suspendido este
  comercio?» sin leer logs, y su índice único `(subscription_id, step, period_key, attempt)`
  hace que el aviso de los siete días se mande **una sola vez** aunque el scheduler corra
  cuatro veces al día.
- **`billing_coupons`** y sus canjes, para conceder un descuento sin desplegar.

Las 13 suscripciones activas que ya existían recibieron su `next_billing_at` en la propia
migración: el cobro recurrente empieza a aplicar sobre la cartera existente sin que nadie
toque una fila a mano.

### La secuencia de cobranza, escrita

Aviso a 7 días → aviso a 3 días → cobro → tres reintentos a 24 h, 72 h y una semana →
periodo de gracia → degradación → suspensión. Cada paso deja su evento y manda su correo.

El backoff crece a propósito: un rechazo por fondos insuficientes se resuelve cuando entra la
nómina, no en la hora siguiente. Reintentar cada hora solo consigue que el banco marque la
tarjeta y que el comercio reciba seis correos.

La degradación es la de la fase 7 y no se tocó: `PAST_DUE` apaga informes y configuración y
**deja la caja funcionando**. Apagarle el punto de venta a un comercio en mora no acelera el
pago, le hace perder el día y nos convierte a nosotros en el problema.

La salida es igual de automática que la entrada: registrar una tarjeta programa el reintento
para ya mismo, así que un comercio suspendido que arregla su medio de pago vuelve solo en la
siguiente pasada del motor, sin buscar ningún botón y sin que nadie de plataforma toque
nada.

### Wompi como pasarela del cobro automático

De las tres integradas, es la que expone fuentes de pago reutilizables en Colombia.
MercadoPago y Stripe siguen sirviendo para el pago manual por checkout. Prometer cobro
automático sobre una pasarela que no lo soporta sería peor que no ofrecerlo: el comercio deja
de vigilar su factura y la suscripción se le cae.

La pasarela de mentira decide el resultado por el token de la tarjeta —uno que contenga
`DECLINE` se rechaza siempre— así que la secuencia entera se ensaya en segundos con el reloj
adelantado, sin depender de la caja de arena de nadie.

### El portal del comercio

Hasta ahora la única pantalla de cobro era el checkout: se pagaba y no se volvía a ver nada.
`GET /billing/portal` devuelve en una petición el plan, el consumo contra los límites, el
medio de pago, las facturas y el rastro de la cobranza —que también cierra lo que quedaba
pendiente de la fase 7—. Hay un botón de «cóbrame ahora» para quien arregla la tarjeta a las
nueve de la mañana y no quiere esperar tres días al reintento programado, y la factura se
abre imprimible en HTML: se guarda como PDF desde el navegador y no arrastra una dependencia
de composición al servidor para un documento de doce líneas.

El panel de plataforma gana `Ingresos`: MRR, ARR, ingreso por cuenta, churn a 30 días y —lo
que antes no se podía medir— **lo efectivamente cobrado frente a lo facturado**. La
diferencia entre esas dos cifras es la que dice si la cobranza funciona.

### Cuatro defectos que encontraron las pruebas, no la lectura

- Una suscripción sin medio de pago quedaba en mora **sin factura**. Se le decía al comercio
  «no pudimos cobrarte» sin decirle cuánto debe ni dónde pagarlo. Ahora la factura se emite
  igual: el periodo transcurre y se debe, se pueda cobrar o no.
- Un fallo al invalidar la caché tumbaba el cobro entero. El dinero ya se había movido:
  propagar ese error dejaba la factura sin asentar. La caché caduca sola en cinco minutos; el
  cobro se asienta igual.
- **La suspensión era un callejón sin salida.** El login devolvía 403 a cualquiera de un
  comercio suspendido, con un «contacta al administrador de la plataforma» heredado de cuando
  suspender era una decisión humana. Ahora que la decide el motor de cobro, el correo de
  suspensión decía «con un pago se reactiva todo», el comercio hacía clic y no podía ni
  entrar a pagar: la única salida era que alguien de plataforma interviniera a mano, que es
  justo lo que el cobro automático viene a evitar. El dueño y el administrador entran ahora,
  y solo para eso: el nivel de servicio sigue siendo `BLOCKED` y `requirePermissions` deniega
  todo lo demás. El resto del equipo sigue fuera, porque solo vería errores.
- **Y el peor de los cuatro.** Al suspender, la factura se marca incobrable. El índice único
  `(subscription_id, period_start)` incluye esas, así que cuando un comercio suspendido
  registraba una tarjeta, el cobro recuperaba la factura vieja, la liquidación exigía `OPEN`
  y no hacía nada — **después** de que la pasarela hubiera cobrado. El comercio pagaba y
  seguía suspendido. Ahora una factura incobrable se reabre al intentar cobrarla otra vez:
  mismo número, y el histórico cuenta lo que pasó de verdad.

Los cuatro son del mismo tipo: código que se lee bien y hace algo distinto de lo que dice.
Ninguno se veía sin recorrer el ciclo entero contra PostgreSQL.

**Criterio de salida — cumplido.** Una suscripción llega a su vencimiento y se cobra sola. Un
cobro rechazado recorre los reintentos, avisa, degrada y suspende sin intervención. Las nueve
pruebas nuevas lo recorren entero con el reloj adelantado y **con la conexión de la app**,
que usa el rol restringido sin BYPASSRLS: con la conexión administrativa pasarían en verde y
el motor no cobraría nada el día del despliegue.

**Lo que queda fuera:** el ensayo contra el ambiente de pruebas de Wompi con llaves reales.
El código está y la variable `WOMPI_API_URL` existe para apuntar al sandbox; falta hacerlo con
una cuenta.

---

## Fase 5 — Escala horizontal ⏳

Estimado: ~1 semana. Diferible hasta ~20 clientes. **Mientras tanto, debe estar escrito y aceptado que el sistema corre en instancia única.**

- `pg_advisory_xact_lock` por scheduler, o migrar los schedulers a repeatable jobs de BullMQ con `jobId` fijo. El cobro de suscripciones ya está protegido por su propio lock desde la fase 8; los demás schedulers —rollups, recheck de la DIAN, limpieza— siguen duplicando trabajo con dos réplicas.
- `@socket.io/redis-adapter` para que mesas y KDS sobrevivan a más de una réplica.
- `FOR UPDATE SKIP LOCKED` en el claim del outbox.

**Criterio de salida.** Dos réplicas de API y dos de worker, sin renovaciones duplicadas ni estado de sala inconsistente.

---

## Instalación local (on-premise)

Trabajo estimado en una a dos semanas, **después de la fase 3** — no antes, porque el on-premise hereda todos los bloqueantes y multiplica el costo de arreglarlos por el número de instalaciones.

### La pregunta previa

Antes de elegir el cómo: ¿el cliente quiere que sus datos no salgan del local, o simplemente no confía en su conexión? La respuesta cambia la solución por completo.

| Opción | Qué implica | Costo de mantener | Cuándo |
|---|---|---|---|
| **A · Docker Compose en un mini-PC** *(recomendada)* | Los mismos contenedores del cloud en un equipo del local; tablets y cajas abren la PWA contra la red interna | Bajo: un solo artefacto, cero divergencia de código, `pull && up -d` | El cliente exige datos en sitio, o la conexión es realmente inviable |
| **B · Instalador nativo** (Electron/Tauri/servicio Windows) | Ejecutable con Postgres embebido y autoactualización | Alto: binarios por plataforma, firma de código, canal propio | Solo si el volumen justifica una línea de producto aparte. Hoy no |
| **C · Cloud con la PWA offline** | Nada nuevo: la cola en IndexedDB ya sostiene la venta durante cortes y sincroniza al volver | Cero — es el producto actual | **Debería ser el caso por defecto.** Empezar aquí y subir a la A solo cuando el cliente lo exija |

### Reparto de responsabilidades

- **En el comercio:** nginx + PWA estática, `api`, `worker`, `postgres 16`, `redis 7`. Un mini-PC N100 con 16 GB y SSD alcanza de sobra. Todo con `restart: unless-stopped` y healthchecks.
- **En nuestra nube:** SuperAdmin de plataforma, billing y suscripciones, métricas agregadas, registro de licencias, backups cifrados. Hoy vive en el mismo binario; se desactiva por variable de entorno saltando el registro de `platformAdminRoutes` y `billingRoutes`.
- **Sale del local (todo saliente, nada entrante — no hay que abrir un puerto en el router del cliente):** emisión DIAN → PAC, check-in de licencia, backup nocturno cifrado, túnel de soporte.

### Los siete puntos que hay que resolver antes de vender la primera

Ordenados por cuánto duele descubrirlos tarde.

1. **HTTPS dentro de la red local — bloqueante, 2–3 d.** La Web Serial API (báscula, ESC/POS directo) y el Service Worker exigen contexto seguro. `http://` solo cuenta como seguro en `localhost`, no en la IP de la máquina vista desde una tablet. Sin resolverlo, en el local se pierden impresión directa y modo offline: exactamente las dos razones por las que el cliente pidió on-premise. Los certificados autofirmados instalados dispositivo por dispositivo funcionan hasta que llega una tablet nueva; la salida limpia es un subdominio real por cliente apuntando a la IP privada, con Let's Encrypt por DNS-01 renovado desde nuestro lado. *Este es el punto que hunde la mayoría de instalaciones on-premise de POS.*
2. **La DIAN sigue necesitando internet — decisión comercial.** On-premise no elimina la dependencia; el outbox acumula y emite al volver la conexión, que es lo correcto. Falta decidir **y escribir en el contrato** cuánto puede facturar un comercio sin conexión antes de que sea un problema fiscal, y qué ve en pantalla mientras tanto.
3. **Backups que no dependan del cliente — 2 d.** Nadie hace respaldos locales. `pg_dump` diario a disco más subida cifrada a nuestro bucket, reutilizando `infra/scripts/`, y prueba de restauración mensual automatizada. Un POS que pierde el histórico de ventas de un comercio no se recupera comercialmente.
4. **Versionado y actualizaciones — 3 d.** Con N instalaciones habrá N versiones. Versionado semántico de imágenes, migraciones estrictamente hacia adelante (nada de `down` en producción), canal de actualización, y telemetría mínima de qué versión corre cada cliente.
5. **Licenciamiento — 3–4 d.** Con la instancia en casa ajena, la suscripción pierde su barrera técnica. Modelo pragmático: check-in firmado cada N horas; si no valida durante X días, modo degradado — **sigue vendiendo y facturando**, porque nunca se bloquea la caja de un comercio, pero deshabilita reportes, backoffice y multi-sucursal.
6. **Acceso remoto — 1 d.** Un túnel saliente por instalación (Tailscale o Cloudflare Tunnel). Sin esto cada incidencia es un desplazamiento.
7. **Precio: on-premise debe costar más, no menos.** La intuición del cliente es la contraria, pero hardware, instalación presencial y soporte en sitio son nuestros. Setup único que cubra equipo e instalación, más mensualidad igual o mayor a la del SaaS.

### El trabajo concreto para tener el instalable

1. `apps/pos-web/Dockerfile`: build de Vite y nginx con `try_files` para el enrutado SPA y proxy de `/api`. Es la única pieza del stack sin imagen.
2. `docker-compose.onprem.yml`: los cinco servicios con healthchecks, `restart: unless-stopped` y volúmenes nombrados.
3. Contenedor `migrate` de un solo uso con `depends_on: {condition: service_completed_successfully}` antes de arrancar la API. Sale gratis si ya se hizo la fase 3.
4. `install.sh`: valida Docker, pide NIT y nombre del comercio, genera los secretos aleatorios, levanta, migra, siembra el tenant e imprime la URL de acceso.
5. `backup.sh` con cron y subida cifrada, más el job mensual de validación de restore.
6. Modo licencia y check-in, con degradación que nunca apaga la caja.

---

## Criterios de salida a producción

Si alguno está sin marcar, la respuesta a "¿ya podemos salir?" es **no**, sin discusión.

- [x] `lint`, `typecheck`, `test` y `build` en verde sobre un clon limpio, ejecutados por CI en un pull request real.
- [x] Los e2e corren contra las migraciones aplicadas desde cero, no contra un esquema parcheado.
- [x] La API corre con un rol sin `BYPASSRLS` y existe una prueba de fuga cruzada que falla si se quita el aislamiento.
- [x] Ningún valor fiscal de un documento DIAN proviene del cliente.
- [x] Una venta que dispara alerta de stock emite su factura. Con prueba.
- [x] Las credenciales del PAC están cifradas.
- [ ] Las credenciales de ejemplo del repositorio fueron rotadas en los entornos reales.
- [ ] `JWT_SECRET`, contraseñas de Postgres y acceso a Grafana son valores generados, no los del repositorio.
- [x] Un `SIGTERM` no corta ninguna venta en vuelo.
- [x] Existe un comando documentado que migra la base en un servidor de producción.
- [ ] Un ciclo fiscal completo verificado con el PAC real: factura aceptada y nota crédito por anulación. *(El código está listo; falta la certificación — ver `docs/CERTIFICACION-PAC.md`.)*
- [x] La numeración fiscal viene de una resolución autorizada, es consecutiva y no se puede duplicar.
- [x] Un documento que queda en `SENT` se resuelve o se alerta; no se queda colgado en silencio.
- [x] Un domicilio entregado genera su documento fiscal.
- [ ] Un restore de backup probado end-to-end en el último mes.
- [ ] Está escrito y aceptado que el sistema corre en instancia única hasta completar la fase 5.

---

## Cómo verificar lo que dice este documento

Nada de lo anterior se sostiene con lectura de código. Todo se reprodujo en un entorno con PostgreSQL 16 y Redis reales:

```bash
pnpm install
pnpm --filter @pos-dian/api db:migrate      # con ADMIN_DATABASE_URL
./infra/scripts/create-api-role.sh "$(openssl rand -base64 32)"
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

Resultado al cierre de la fase 4: **0 errores de lint** (144 advertencias, ver D-043), **0 errores de tipos**, build correcto, **91 migraciones desde cero** y **282 pruebas verdes** — 173 API contra PostgreSQL real, 60 worker, 31 pos-web, 18 shared.

Detalle de las decisiones en `docs/DECISIONS.md` (D-036 … D-062). Procedimientos operativos en `docs/RUNBOOK.md`. Guía de certificación en `docs/CERTIFICACION-PAC.md`.
