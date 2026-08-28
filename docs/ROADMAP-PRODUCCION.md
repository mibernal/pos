# Ruta a Producción

Estado al **28 de agosto de 2026** (fases 0–3 cerradas). Este documento es el registro vivo del endurecimiento previo a producción: qué se cerró, con qué evidencia, y qué falta.

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
| 4 | Cerrar el ciclo fiscal con el PAC real | ⏳ Pendiente · 2–3 semanas, depende de terceros |
| 5 | Escala horizontal | ⏳ Diferible hasta ~20 clientes |

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

## Fase 4 — Cerrar el ciclo fiscal con el PAC real ⏳

Estimado: 2–3 semanas, con dependencia de terceros. **Conviene arrancar la gestión comercial con el PAC en paralelo, ya**, porque los tiempos de certificación no dependen de nosotros. Bloquea facturar legalmente.

- **Certificación end-to-end** contra el ambiente de pruebas del PAC, y luego producción con un tenant piloto y volumen controlado.
- **Cerrar el ciclo de los documentos en `SENT`**: el recheck ya existe (`DIAN_SENT_RECHECK_DELAY_MS`), falta el webhook o la consulta de confirmación definitiva y una alerta si algo lleva más de N horas sin resolverse. Hoy un documento puede quedarse en `SENT` para siempre sin que nadie se entere.
- **Resolución, prefijo y rangos por tenant**: los campos ya están en la tabla; falta el control de consecutivo y el aviso de agotamiento *antes* de que se acabe el rango. Quedarse sin numeración un viernes por la tarde es un comercio que no puede facturar.
- **Vincular domicilios al flujo de venta** para que generen documento fiscal.

**Criterio de salida.** Un ciclo completo verificado con la DIAN: factura aceptada, nota crédito por anulación, y consecutivo controlado.

---

## Fase 5 — Escala horizontal ⏳

Estimado: ~1 semana. Diferible hasta ~20 clientes. **Mientras tanto, debe estar escrito y aceptado que el sistema corre en instancia única.**

- `pg_advisory_xact_lock` por scheduler, o migrar los schedulers a repeatable jobs de BullMQ con `jobId` fijo. Con dos réplicas hoy, las renovaciones se cobran dos veces.
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
- [ ] Un ciclo fiscal completo verificado con el PAC real: factura aceptada y nota crédito por anulación.
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

Resultado al cierre de la fase 3: **0 errores de lint** (144 advertencias, ver D-043), **0 errores de tipos**, build correcto, **90 migraciones desde cero** y **243 pruebas verdes** — 153 API contra PostgreSQL real, 41 worker, 31 pos-web, 18 shared.

Detalle de las decisiones en `docs/DECISIONS.md` (D-036 … D-055). Procedimientos operativos en `docs/RUNBOOK.md`.
