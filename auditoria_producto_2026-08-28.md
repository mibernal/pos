# Auditoría de producto y hoja de ruta — 28 de agosto de 2026

Analizado sobre `main @ f98a91d`. 91 migraciones, 280 archivos de API (~28.600 líneas),
~21.500 líneas de PWA, 282 pruebas.

Complementa `docs/ROADMAP-PRODUCCION.md`, que cubre las fases 0–5 de endurecimiento.
**El ciclo DIAN queda fuera de alcance por petición expresa.**

Cada hallazgo cita archivo y línea para poder contrastarlo antes de aceptarlo.

---

## 0. El patrón que se repite

Casi todos los defectos tienen la misma forma: **una capa se movió y las otras se
quedaron.** La migración 074 cambió a qué tabla apunta `sales.waiter_id` y el informe de
meseros siguió uniendo contra la anterior. La migración 086 añadió seis macro-módulos y la
consulta de login no los selecciona. El catálogo de planes usa `id` y el alta de comercios
busca por `name`. Ninguno falla ruidosamente: todos degradan en silencio.

---

## 1. Planes y entitlements — los planes no gobiernan nada

Un plan es hoy un registro con `price_cents` y un `features_json` de dos claves (`users`,
`branches`). Los módulos viven en 21 columnas booleanas de `tenants` que un super-admin
enciende a mano, sin relación con el plan. Precio y producto son dos sistemas
independientes.

| Id | Severidad | Hallazgo |
|---|---|---|
| PL-01 | Crítico | **El alta puede dejar un comercio sin suscripción, sin error.** `CreateTenantUseCase` busca el plan por `billing_plans.name`, pero el catálogo tiene `id: 'STARTER'` / `name: 'Plan Starter'`. Si llega el id, `planRow` es undefined y el `if (planRow)` salta la creación y devuelve 201. A partir de ahí toda cuota responde 403 y el plan del token es `null`. → `platform-admin/application/tenants/create-tenant.use-case.ts:71`, misma búsqueda en `change-tenant-plan.use-case.ts:12` |
| PL-02 | Crítico | **Durante el trial no se puede montar el negocio.** El registro público crea la suscripción en `TRIAL`; `QuotaGuard` exige `status = 'ACTIVE'` y si no la encuentra lanza `403 QUOTA_EXCEEDED`. Durante los 14 días no se puede crear un cajero ni una sucursal, con un mensaje que sugiere límite agotado. → `shared/infra/security/quota-guard.ts:20`, `auth.routes.ts:115` |
| PL-03 | Crítico | **El estado de la suscripción no se comprueba en ninguna petición.** Solo `tenants.status = 'SUSPENDED'` bloquea, y solo en login. Una suscripción `CANCELLED`, `PAST_DUE` o vencida sigue operando con normalidad. → `identity/http/auth.routes.ts:264,323,544` |
| PL-04 | Alto | **`cancelSubscription` escribe `'CANCELED'`** (una L) mientras el tipo y las métricas usan `'CANCELLED'`. Las bajas no aparecen en el churn. → `billing/application/subscription.service.ts:172` vs `domain/subscription-states.ts:6` |
| PL-05 | Alto | **Nada impide dos suscripciones por comercio.** Sin índice único por `tenant_id`, y todas las lecturas hacen `executeTakeFirst()` sin `ORDER BY`. Cuál se lee es arbitrario, incluido el `plan_id` que se firma en el JWT. → `migrations/047_billing_tables.ts:16`, `auth.utils.ts:142` |
| PL-06 | Alto | **Los seis macro-módulos valen siempre falso.** `buildAuthClaims` lee `enable_restaurant/kds/inventory/fiscal/loyalty/advanced_reports` con `?? false`, pero ni el login ni `getUserForAuth` los seleccionan. Nadie lo nota porque ninguna ruta los usa; el día que se proteja el módulo fiscal con `requireModule(['fiscal'])`, responderá 403 a todos. → `auth.utils.ts:51-56` vs `:143-168` y `auth.routes.ts:183-212` |
| PL-07 | Medio | **Un módulo nuevo cuesta cuatro sitios**: columna, claim, `switch` de 21 ramas, y `FeatureModuleProvider`. Nada obliga a que coincidan (PL-06 es ese fallo). Al ir en el token, encender un módulo no surte efecto hasta renovar sesión. |
| PL-08 | Medio | **Cambiar de plan no prorratea ni valida a la baja.** Es un `UPDATE plan_id`. Bajar de PRO a STARTER con 8 usuarios deja al comercio fuera de cuota sin aviso. No toca módulos. |

---

## 2. Cobro de la suscripción — no está terminado

| Id | Severidad | Hallazgo |
|---|---|---|
| SU-01 | Crítico | **La renovación automática es un comentario.** `processRenewals` y `processRetries` tienen el cobro comentado; `processTrialExpirations` lleva `// TODO: Si auto_renew es true, intentar cobrar el primer mes`. Todos los caminos terminan en `markPastDue`. Aunque estuviera escrito, `payment_method_token` no se llena en ningún sitio: el checkout de Wompi es pago único sin tokenización. → `billing/application/renewal-engine.ts:33,112,155` |
| SU-02 | Crítico | **Un plan anual concede un mes.** `billing_cycle` se pasa a la pasarela para cobrar, pero activación y renovación suman 30 días fijos. → `process-payment-webhook.ts:110-118`, `subscription.service.ts:57,91` |
| SU-03 | Alto | **El webhook no compara el importe cobrado** contra `payment_transactions.amount_cents` ni contra el precio del plan. La firma protege el origen, no el importe. → `process-payment-webhook.ts:99-107` |
| SU-04 | Alto | **Todo webhook responde 200**, incluidos los que fallan. Se descarta también el reintento legítimo: si la base falla al procesar un pago aprobado, la pasarela lo da por entregado y el cobro se pierde. No hay tabla de eventos recibidos. → `billing/http/webhooks.routes.ts:32-42,60,82` |
| SU-05 | Medio | **El correo de pago aprobado siempre dice cero**: lee `metaData?.amount` de un `metadata_json` que solo guarda `planId`, `checkoutUrl`, `autoRenew`. → `process-payment-webhook.ts:140` |
| SU-06 | Medio | **El comercio paga y no recibe documento.** Sin factura del SaaS, histórico, cupones, descuento anual ni IVA sobre la suscripción. |

---

## 3. Pagos en caja — cobra bien, pero cobra poco

El motor de venta es lo mejor construido: recalcula impuestos en servidor, detecta deriva
de precios, exige código de aprobación en tarjeta y deriva el arqueo del desglose real de
pagos. El límite está en el catálogo de medios y en lo que rodea al cobro.

| Id | Severidad | Hallazgo |
|---|---|---|
| CA-01 | Crítico | **Tres medios de pago**: `CASH`, `CARD`, `TRANSFER`. Faltan billeteras con QR (Nequi, Daviplata, Bre-B), bonos/gift card, crédito del cliente (fiado), redención de puntos y vales. Cada uno necesita su tratamiento en el arqueo. → `packages/shared/src/schemas/sale.ts:8`, `sales/services/payments.ts:56-70` |
| CA-02 | Alto | **No se registra lo recibido ni el vuelto.** La venta exige que los pagos sumen exactamente el total. El cajero que recibe 50.000 por 32.400 no tiene dónde anotarlo. → `sales/services/create-sale.service.ts:433` |
| CA-03 | Alto | **La propina se cobra pero no se liquida.** Sin reparto individual ni bolsa común, sin separar efectivo de tarjeta, sin pago al cierre, y sin el movimiento de caja que saque la propina en efectivo — que entretanto infla el efectivo esperado del arqueo. → `migrations/063_sales_tips.ts` |
| CA-04 | Medio | **División por montos no llega al cobro.** `CheckoutModal` recibe `initialSplitAmounts` y no lo usa. La división por partes iguales sí funciona. → `CheckoutModal.tsx:32` |
| CA-05 | Medio | **El datáfono está fuera del sistema.** `approval_code` se teclea a mano y nada lo concilia contra el lote del adquirente. |
| CA-06 | Medio | **Sin cuentas por cobrar** → no se puede vender a crédito ni cerrar mes con clientes corporativos. |

---

## 4. Meseros — el flujo se corrigió, la identidad no

| Id | Severidad | Hallazgo |
|---|---|---|
| ME-01 | Crítico | **El PIN se guarda en claro y la API lo devuelve.** `waiters.pin` es `varchar(20)` insertado tal cual; el repositorio hace `selectAll()` y el esquema de respuesta de `GET /branches/:branchId/waiters` incluye el campo. Esa ruta está abierta a cualquiera con el módulo activo, así que cualquier empleado lee el PIN de todos desde la pestaña de red. La UI pinta `****`; la respuesta trae el número. Falta además unicidad por sucursal y longitud mínima. → `migrations/071:12`, `tables/infra/waiters.repository.ts:13,42`, `presentation/waiters.routes.ts:19`, `shared/src/schemas/waiters.ts:9` |
| ME-02 | Crítico | **El informe de meseros sale vacío en producción.** Dos defectos: (a) `WaiterReportsUseCase` une `users.id = sales.waiter_id`, pero desde la migración 074 ese campo referencia `waiters.id` → todas las filas salen «Sin Mesero Asignado»; (b) consulta `app.db` **fuera de `executeAsTenant`**, así que con RLS forzado y rol sin BYPASSRLS `sales` devuelve cero filas. → `reporting/application/waiter-reports.use-case.ts:10`, `reporting/http/reports.routes.ts:130` |
| ME-03 | Alto | **Dos nociones de mesero conviven**: rol `WAITER` de `users` (mig. 066) y tabla `waiters` (071). `waiters.user_id` es opcional y nada lo exige: un mesero que entra con su cuenta no queda atribuido en sus ventas. |
| ME-04 | Medio | **La sucursal no se valida contra el comercio.** `createWaiter` inserta el `branchId` de la URL; la política RLS comprueba `tenant_id` (que pone el servidor), no la sucursal. → `waiters.repository.ts:38` |
| ME-05 | Medio | **`enable_waiter_shifts` es un flag sin implementación**: sin apertura/cierre por mesero, rango de mesas ni corte por turno. |
| ME-06 | Medio | **Sin cuota de meseros por plan.** |

---

## 5. Frontend ↔ backend

El contrato entre las dos mitades es un punto fuerte: tipos desde `@pos-dian/shared`,
validación Zod con OpenAPI publicado, token en memoria renovado por cookie httpOnly con
deduplicación. La deuda está en cómo está montada la app de React.

| Id | Severidad | Hallazgo |
|---|---|---|
| FE-01 | Alto | **No hay enrutador.** `App.tsx` resuelve la pantalla con un `if/else` de 381 líneas. `react-router-dom` está en `package.json` y **no se importa en ningún archivo**. Sin URL por pantalla, sin enlace profundo, el botón atrás sale de la app y recargar vuelve al inicio — en una tablet de salón, perder el pedido en curso. |
| FE-02 | Alto | **Dos formas de llamar al backend**: `api` como prop desde `App.tsx` (sin caché ni invalidación) y hooks de React Query. La misma pantalla puede mezclarlas. |
| FE-03 | Medio | **Cliente escrito a mano (803 líneas) habiendo OpenAPI.** `BranchItem`, `CashSession` y `TerminalItem` se redeclaran a mano: si la API añade un campo, TypeScript no se entera. → `lib/api/client.ts:71-100` |
| FE-04 | Medio | **Acciones de plataforma muertas.** `AdvancedTenantsTable` recibe `onChangePlan`, `onSuspend`, `onReactivate` y no invoca ninguno. → `AdvancedTenantsTable.tsx:24` |
| FE-05 | Alto | **El camino del dinero no tiene e2e.** Dos archivos de prueba en toda la PWA frente a 19 en la API, sin Playwright ni Cypress. Sumado a pantallas de 964 y 1.012 líneas (`PosScreen.tsx`, `ticket-printer.ts`), cada cambio ahí es una apuesta. |

---

## 6. Dónde está el techo comercial

| Hueco | Qué significa comercialmente | Estado en el repo |
|---|---|---|
| **Compras y proveedores** | Sin costo de reposición el margen real no se calcula. Es la primera pregunta del dueño | tabla `suppliers` desde la mig. 022, sin ruta ni pantalla |
| **Recetas / escandallo** | El inventario no baja por ingrediente al vender un plato: el módulo fuerte no sirve al vertical que mejor cubrimos | sin rastro en el código |
| **Fidelización** | Sin puntos no hay retención del comercio ni del comensal | `enable_loyalty` es solo un flag |
| **Pedido y pago por menú QR** | Publica catálogo pero no toma pedidos ni cobra: media función de la que más piden | `GET /public/catalog/:branchId` solo lectura |
| **API pública / webhooks salientes** | Ninguna integración es posible sin tocar código. Es lo que convierte un POS en plataforma | sin llaves de API por comercio |
| **Promociones v2** | Hoy: un producto, un rango de fechas. Faltan combos, happy hour, categoría, segmento | `promotions.ts` — tres tipos, sin condiciones |
| **Roles a medida** | Permisos fijos en código por rol; un grupo con varias marcas no cabe | `ROLE_PERMISSIONS` constante, 7 roles |
| **Analítica de uso por comercio** | Hay MRR y altas, pero no activación ni uso por módulo: no se sabe a quién subir de plan ni quién se va | métricas agregadas, no por comercio |

---

## 7. Hoja de ruta

Seis fases que continúan la numeración del endurecimiento (0–5). Estimaciones en
semanas-persona para quien conoce el código. Cada fase termina en un criterio verificable.

### Fase 6 — Cerrar las fugas silenciosas · 1,5–2 semanas

Todo lo que hoy falla sin decirlo. Ninguna corrección necesita decisión de producto.

- Buscar el plan por `id` en alta y cambio de plan, y fallar con 400 si no existe. `PL-01`
- Aceptar `TRIAL` además de `ACTIVE` en `QuotaGuard`; separar «sin suscripción» de «cuota agotada». `PL-02`
- Unificar `CANCELLED`; índice único parcial de suscripción activa por comercio; ordenar todas las lecturas. `PL-04, PL-05`
- Seleccionar los seis macro-módulos en login y `getUserForAuth`, con prueba que compare claims contra columnas. `PL-06`
- Respetar `billing_cycle` al activar y renovar. `SU-02`
- Contrastar el importe del webhook contra la transacción y el precio del plan. `SU-03`
- Tabla `payment_webhook_events` con cuerpo crudo y deduplicación; 4xx a firma inválida, 5xx a fallo transitorio. `SU-04`
- Sacar el PIN de la respuesta y guardarlo con Argon2; verificar por comparación. `ME-01`
- Corregir el informe de meseros: unir contra `waiters` y envolver en `executeAsTenant`. `ME-02`
- Cablear `onChangePlan` / `onSuspend` / `onReactivate`. `FE-04`
- Higiene: borrar los cuatro `*.ts.o<hash>` versionados en `migrations/` y renumerar la 042 duplicada.

**Criterio de salida.** Un comercio se registra, monta dos usuarios y una sucursal durante
la prueba gratuita, paga un plan anual y recibe 365 días. El informe de meseros muestra
nombres. `GET /waiters` no contiene ningún PIN. Una prueba por caso.

### Fase 7 — Que el plan gobierne el producto · 2–3 semanas

- `plan_entitlements` con límites (usuarios, sucursales, productos, terminales, meseros, mesas, ventas/mes) y módulos incluidos, más `tenant_overrides` para excepciones comerciales.
- Derivar los módulos del plan + overrides; dejar los 21 booleanos como vista de compatibilidad. `PL-07`
- Resolver entitlements por petición desde Redis con invalidación al cambiar el plan, en vez de firmarlos en el token.
- `EntitlementGuard` genérico que sustituya a `QuotaGuard` y `requireModule`, con la cuenta bloqueada dentro de la transacción.
- Estado de suscripción en el ciclo de petición, con degradación por niveles: `PAST_DUE` sigue vendiendo y facturando; suspende backoffice, informes y multi-sucursal. **La caja nunca se apaga.** `PL-03`
- Prorrateo al subir, validación al bajar y previsualización del cambio. `PL-08`
- Editor de planes sobre el nuevo modelo.

**Criterio de salida.** Crear un plan con sus módulos y límites, asignarlo y ver el cambio
sin que nadie cierre sesión ni se toque una migración. Bajar de plan avisa qué queda fuera
de cuota.

### Fase 8 — Cobro recurrente que ocurre solo · 2–3 semanas

- Tokenización con la pasarela que la soporte (elegir Wompi o MercadoPago como principal, la otra queda como pago manual).
- Terminar el motor: cobro real, reintentos con backoff, y bloqueo por `pg_advisory_xact_lock` — el `skipLocked` actual suelta el lock en el commit antes de procesar. `SU-01`
- Secuencia de cobranza escrita: aviso a 7 y 3 días, cobro, tres reintentos, gracia, degradación, suspensión.
- Factura de la suscripción con consecutivo, IVA e histórico. `SU-06`
- Ciclo anual con descuento, cupones y cortesías.
- Portal de facturación del comercio: plan, consumo contra límites, medio de pago, facturas, cambio de plan.
- Panel de ingresos con MRR y churn sobre datos correctos.

**Criterio de salida.** Una suscripción vence y se cobra sola. Un cobro rechazado recorre
reintentos, avisa, degrada y suspende sin intervención. Ensayado contra el ambiente de
pruebas de la pasarela con el reloj adelantado.

### Fase 9 — La caja completa · 3 semanas

- Ampliar medios: QR, bono/gift card, crédito del cliente, puntos, vales — cada uno con su tratamiento en el cierre. `CA-01`
- Recibido y vuelto registrados en la venta. `CA-02`
- Cuentas por cobrar: cupo, abonos, estado de cuenta, corte mensual. `CA-06`
- Liquidación de propina: individual o bolsa común, separada por efectivo y tarjeta, con pago al cierre y su movimiento de caja. `CA-03`
- Terminar la división por montos. `CA-04`
- Integración con datáfono de al menos un adquirente, con conciliación del lote. `CA-05`

**Criterio de salida.** Un turno que mezcle efectivo con vuelto, tarjeta conciliada, QR, un
bono, un fiado y propina repartida cierra con diferencia cero, y cada medio aparece
desglosado en el reporte Z.

### Fase 10 — El restaurante, completo · 3–4 semanas

- Unificar la identidad del mesero: ficha de personal opcionalmente ligada a una cuenta, una sola vía de atribución. `ME-03`
- Turnos reales: apertura y cierre, rango de mesas, corte por turno, liquidación de propinas. `ME-05`
- Validar pertenencia de sucursal y cuota de meseros por plan. `ME-04, ME-06`
- Recetas y escandallo: descarga por ingrediente, costo teórico, margen por plato, desviación contra conteo físico.
- Pedido y pago desde el menú QR sobre la infraestructura de mesas y KDS existente.
- Informes de operación: rotación de mesa, tiempo por estación, ventas por franja, plato estrella vs. plato lento.

**Criterio de salida.** Un servicio completo en un restaurante piloto: mesero entra con
PIN, toma pedido, cocina despacha, la mesa se divide y se cobra, el inventario baja por
ingrediente y el cierre liquida las propinas del turno.

### Fase 11 — Un frontend en el que se pueda seguir construyendo · 2–3 semanas

Va después de la 10 a propósito: para entonces el alcance está claro y la refactorización
no persigue un objetivo móvil.

- Enrutador real sobre la dependencia ya instalada, con URL por pantalla, carga diferida por ruta y guardas en la definición. `FE-01`
- React Query en todas las pantallas; cliente como módulo, no como prop. `FE-02`
- Cliente generado desde el OpenAPI, con verificación en CI de que generado y versionado coinciden. `FE-03`
- Un único origen para el mapa de módulos, compartido API/PWA, con prueba que falla si divergen. `PL-07`
- Descomponer `PosScreen` y `ticket-printer`; sacar la lógica de cobro a hooks con prueba.
- Playwright en CI sobre el camino del dinero: carrito, cobro, impresión, corte de red, cola offline, sincronización. `FE-05`

**Criterio de salida.** Recargar cualquier pantalla la devuelve donde estaba. El e2e del
camino del dinero corre en cada pull request. Añadir un endpoint no requiere escribir tipos
a mano.

### Fase 12 — Convertir el POS en plataforma · continuo, tras la fase 8

Bloques independientes, priorizados por lo que pida el mercado.

- **Compras y proveedores** — órdenes, recepción contra orden, costo promedio, margen real (2–3 sem)
- **Fidelización** — puntos, niveles, campañas, cumpleaños (2 sem)
- **API pública y webhooks salientes** — llaves por comercio, límites, documentación (2 sem)
- **Promociones v2** — combos, franja horaria, categoría, segmento (1–2 sem)
- **Roles a medida** — permisos por comercio sobre el catálogo existente (1 sem)
- **Analítica de uso por comercio** — activación, uso por módulo, señales de abandono (1–2 sem)

**Criterio de salida por bloque.** Una integración externa construida por alguien ajeno al
equipo usando solo la documentación pública.

### Calendario agregado

| Fase | Objetivo | Esfuerzo | Acumulado | Desbloquea |
|---|---|---|---|---|
| 6 | Cerrar fugas silenciosas | 1,5–2 sem | 2 sem | Vender sin corregir a mano |
| 7 | Plan → producto | 2–3 sem | 5 sem | Precios y empaquetado |
| 8 | Cobro recurrente | 2–3 sem | 8 sem | Escalar clientes sin escalar personas |
| 9 | Caja completa | 3 sem | 11 sem | Tienda y barrio |
| 10 | Restaurante completo | 3–4 sem | 15 sem | Plan alto y vertical propio |
| 11 | Frontend sostenible | 2–3 sem | 18 sem | Velocidad de todo lo siguiente |
| 12 | Plataforma | por bloques | — | Integraciones y retención |

Unos cuatro meses y medio a dedicación completa para una persona. Con dos, las fases 9 y 11
se pueden solapar: tocan mitades distintas del repositorio.

---

## 8. Por qué este orden, y qué no hacer todavía

La fase 6 va primero porque son fallos que hoy se pagan con trabajo manual en cada alta y
cada cobro, y ninguno exige decidir nada. La 7 va antes que la 8 porque cobrar bien por un
plan que no gobierna nada solo automatiza el problema. La 9 y la 10 van antes que la 11
porque son las que se venden. La 11 va antes que la 12 porque a partir de ahí el coste de
cada función nueva depende de lo ordenada que esté la app de React.

**Tres cosas que conviene no hacer aún:**

1. **Multi-país o multi-moneda.** El modelo asume COP en centavos y régimen colombiano de
   punta a punta. Abrirlo antes de resolver el mercado local multiplica el coste de cada
   fase.
2. **App móvil nativa.** La PWA ya cubre tablet de salón y caja. Una nativa añade tiendas,
   firmas y canal de actualización a cambio de poco mientras el navegador cubra impresión y
   cola offline.
3. **Reescribir el frontend desde cero.** El problema no es React ni la estructura por
   features: es el enrutador que falta y las dos formas de llamar al backend. Ambas se
   arreglan por dentro, en tres semanas, sin parar de entregar.

**Riesgo que no se cierra con código.** Siguen abiertos, y ninguna fase de este documento
los resuelve: la certificación con el PAC (depende de un tercero) y la rotación de las
credenciales de ejemplo del repositorio en los entornos reales. Son criterios de salida, no
tareas pendientes.
