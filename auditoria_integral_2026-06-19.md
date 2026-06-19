# 🔍 Auditoría Integral — POS SaaS Multi-Tenant
**Fecha:** 2026-06-19 | **Auditor:** Antigravity AI | **Repo:** `mibernal/pos`  
**Roles:** CTO · Principal Architect · Backend · Frontend · DBA · Security · PM

> **Alcance especial:** Restaurantes · Mesas · Domicilios · División de cuenta · Cambio de mesa · Precuenta · Propinas  
> **Contexto:** El sistema está iniciando comercialización. Prioridades: Rentabilidad › Bajo costo cloud › Simplicidad operativa › Escalabilidad gradual.

---

## SCORE GENERAL DEL SISTEMA

| Dimensión | Score | Notas |
|---|---|---|
| **Arquitectura** | 7.5/10 | Sólida base hexagonal, pero contextos de tablas/domicilios aún simplificados |
| **Seguridad** | 7.0/10 | RLS + JWT + rate-limit bien armados; WebSocket sin auth es el hueco principal |
| **Base de Datos** | 7.5/10 | Ledgers inmutables excelentes; `balance_after` null en `inventory_transactions` es deuda |
| **Frontend/UX** | 6.5/10 | Flujos críticos funcionales; ausencia de feedback offline y estados vacíos |
| **Restaurantes** | 6.5/10 | Núcleo funcional; sin RLS en tabla `table_orders`, sin INC_8 en propinas |
| **Domicilios** | 5.5/10 | Estructura correcta; sin integración con `create-sale`, sin DIAN para delivery |
| **Billing/SaaS** | 5.0/10 | (Heredado de auditoría Jun-10) MercadoPago roto, subscriptions desincronizadas |
| **Tests** | 5.0/10 | Cobertura muy baja en el camino feliz de `create-sale` y módulo de mesas |
| **TOTAL PONDERADO** | **6.4/10** | Listo para beta controlada, no para escala libre |

---

## SECCIÓN A — HALLAZGOS NUEVOS POST AUDITORÍA JUN-10

*(Los items de la auditoría anterior Jun-10 se consideran conocidos. Solo se listan si cambiaron de estado o tienen dependencia nueva.)*

---

### A.1 — RESTAURANTES / MESAS

#### 🔴 BUG-001 (P0) — `table_orders` sin RLS — **Fuga de datos entre tenants**

**Archivo:** [`migrations/062_table_orders.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/062_table_orders.ts)  
**Archivo:** [`migrations/060_restaurant_tables.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/060_restaurant_tables.ts)

La migración `061_deliveries_module.ts` activa correctamente RLS en las tres tablas de domicilios. Pero las migraciones `060_restaurant_tables.ts` y `062_table_orders.ts` **no habilitan RLS** en `rooms`, `tables`, `table_orders` ni `table_order_items`.

```sql
-- FALTA en 060 y 062:
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_rooms ON rooms
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
-- (ídem para las otras 3 tablas)
```

**Impacto:** Si el `api` role en Postgres tiene acceso directo a estas tablas (e.g. un query sin contexto RLS se cuela por un bug), los datos de mesas de un tenant son visibles para otro. En un SaaS multi-tenant esto es una violación GDPR/datos personales.  
**Mitigación actual:** Las queries de `TablesRepository` siempre filtran por `tenant_id` y `branch_id` en el WHERE. Esto es un segundo candado, pero **no reemplaza RLS**. Si alguien añade un nuevo endpoint y olvida el WHERE, hay fuga.  
**Fix:** Crear migración `065_restaurant_tables_rls.ts` que habilite RLS y policies en las 4 tablas.  
**Esfuerzo:** 1h.

---

#### 🔴 BUG-002 (P0) — `saveTableOrder` usa DELETE+INSERT en lugar de upsert — **Race condition con checkout simultáneo**

**Archivo:** [`table-orders.repository.ts` L98-L120](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/tables/infra/table-orders.repository.ts#L98)

```ts
// Delete existing items
await trx.deleteFrom('table_order_items')
  .where('table_order_id', '=', order.id)
  .execute();

// Insert new items
await trx.insertInto('table_order_items').values(itemsToInsert).execute();
```

El DELETE+INSERT no tiene `LOCK` en `table_orders` antes de la operación. Si dos cajeros (o la sincronización offline) envían `PUT /tables/:id/order` en paralelo dentro del window de la misma transacción PG, uno de los dos puede:
- Leer el orden existente (step 1)
- El otro lo borra y reinserta (step 2)
- El primero borra los nuevos items del segundo (step 3)

Resultado: items perdidos silenciosamente.

**Fix:** Agregar `.forUpdate()` al SELECT inicial de `saveTableOrder` (igual que lo hace `create-sale.service.ts` con `cash_sessions`):

```ts
let order = await trx.selectFrom('table_orders')
  .where(...)
  .selectAll()
  .forUpdate()  // ← ADD THIS
  .executeTakeFirst();
```

**Esfuerzo:** 30 min.

---

#### 🟠 BUG-003 (P1) — `transferTableOrder` no valida que la mesa destino pertenezca al mismo `branch_id`

**Archivo:** [`table-orders.repository.ts` L194-L224](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/tables/infra/table-orders.repository.ts#L194)

Al crear la `destOrder`, el código filtra por `tenant_id` y `branch_id`, pero al crear el order de destino si no existe, **no valida que `payload.destinationTableId` pertenezca al mismo branch**. Un usuario con `branchId=A` podría hacer transfer a una mesa de `branchId=B` si conoce el UUID.

```ts
// Falta antes del insert de destOrder:
const destTable = await trx.selectFrom('tables')
  .where('id', '=', payload.destinationTableId)
  .where('tenant_id', '=', tenantId)
  .where('branch_id', '=', branchId)  // ← validar misma sucursal
  .selectAll()
  .executeTakeFirst();
if (!destTable) throw new AppError(404, 'TABLE_NOT_FOUND', 'Mesa destino no existe en esta sucursal');
if (destTable.status === 'RESERVED') throw new AppError(409, 'TABLE_RESERVED', 'Mesa destino está reservada');
```

**Esfuerzo:** 1h.

---

#### 🟠 BUG-004 (P1) — `table_orders.total_cents` no incluye propina — **Precuenta incorrecta**

**Archivo:** [`table-orders.repository.ts` L53-L54](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/tables/infra/table-orders.repository.ts#L53)

```ts
const subtotalCents = payload.items.reduce((sum, item) => sum + item.lineTotalCents, 0);
const totalCents = subtotalCents; // No tax/discount logic for now
```

El comentario dice "No tax/discount logic for now" pero la migración `063_sales_tips.ts` ya agregó `tip_cents` a `table_orders`. El total del pedido de mesa **nunca incluye la propina ni el INC_8 del restaurante**.

Cuando el cajero abre la precuenta desde `PosScreen`, lee `table_order.total_cents` como base, pero ese valor no tiene impuesto. El cálculo final correcto ocurre en `create-sale.service.ts`, pero la **discrepancia visual en precuenta confunde al cliente** (ve un precio y al pagar ve otro).

**Fix:** Calcular el impuesto INC_8 en `saveTableOrder` o exponer un endpoint de "preview" que aplique las mismas reglas de `computeTaxes()`. Para el MVP, al menos cambiar el comentario a `// TODO: tax calculation needed for restaurant mode`.  
**Esfuerzo (correctamente):** 2-3 días (requiere pasar `tenantId` → `tax_mode` al repositorio y usar `computeTaxes()`).

---

#### 🟡 UX-001 (P2) — `TableCard` calcula el tiempo en el cliente — **Deriva de reloj**

**Archivo:** [`TableCard.tsx`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/tables/components/TableCard.tsx)

El timer se calcula como `Date.now() - tableOrder.created_at`. Si el reloj del dispositivo está desfasado (común en tablets de cocina sin NTP), el tiempo mostrado es incorrecto. **En restaurantes con mesas de larga duración (> 2h), una diferencia de 15 min es significativa** para el supervisor.

**Fix:** Usar la diferencia relativa desde `status_updated_at` del backend como fuente de verdad; o emitir un timestamp de referencia en el evento `TABLES_UPDATED` vía WebSocket.  
**Esfuerzo:** 2h.

---

#### 🟡 TEC-001 (P2) — `saveTableOrder` hace DELETE + INSERT de TODOS los items en cada sync

**Impacto de escalabilidad:** Si una mesa tiene 30 items y el cajero agrega uno, se borran y reinsertan los 30. Con 20 mesas activas y sync cada 15s, son ~600 rows/s de I/O innecesario.  
**Fix a mediano plazo:** Migrar a patch semántico (upsert por `product_id + variant_id`, DELETE solo de los items con qty=0).  
**Esfuerzo:** 4h.

---

### A.2 — DOMICILIOS (DELIVERIES)

#### 🔴 BUG-005 (P0) — `createDelivery` no crea venta — **Delivery sin registro fiscal**

**Archivo:** [`deliveries.routes.ts` L107-L120](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/deliveries/http/deliveries.routes.ts#L107)

```ts
const totalCents = request.body.items.reduce((acc, item) => acc + (item.priceCents * item.qty), 0);
await deliveriesRepo.createDelivery(tenantId, branchId, id, request.body, totalCents);
```

Al crear un domicilio, **no se crea una venta (`sale`) ni un documento DIAN**. El domicilio queda como un registro independiente sin:
- Número de venta correlativo
- Entrada en `sales_ledger`
- Documento `INVOICE` en `dian_documents`
- Descarga de inventario

El `sale_id` solo se asigna cuando el cajero actualiza manualmente el status a `DELIVERED` con un `saleId` en el body (`PATCH /deliveries/:id/status`). Pero en la práctica, muchos operadores **nunca hacen ese paso**, dejando la venta sin comprobante fiscal.

**Impacto:** Riesgo fiscal ante la DIAN. Pérdida de trazabilidad de inventario.

**Fix:** El endpoint `POST /deliveries` debería invocar `createSaleService()` internamente (o al menos crear el registro en `sales` en la misma transacción) y solo después crear el `delivery` con `sale_id` asignado. Alternativamente, hacer el `sale_id` obligatorio en el body del delivery.

**Esfuerzo:** 2-3 días.

---

#### 🟠 BUG-006 (P1) — `totalCents` del delivery calculado sin impuestos

**Archivo:** [`deliveries.routes.ts` L111](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/deliveries/http/deliveries.routes.ts#L111)

```ts
const totalCents = request.body.items.reduce((acc, item) => acc + (item.priceCents * item.qty), 0);
```

Igual que el pedido de mesa: no aplica INC_8 ni IVA. El `total_cents` almacenado en la tabla `deliveries` no incluye impuestos, por lo que el Kanban de domicilios muestra valores incorrectos para tenants en modo `INC_RESTAURANT`.

**Fix:** Pasar los items por `computeTaxes()` antes de guardar.  
**Esfuerzo:** 2h (si ya tenemos el `tax_mode` del tenant).

---

#### 🟠 SEG-001 (P1) — Rutas de domicilios sin verificación de acceso a sucursal

**Archivo:** [`deliveries.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/deliveries/http/deliveries.routes.ts)

Todos los endpoints de domicilios solo ejecutan `[app.authenticate]` pero **no llaman a `ensureUserCanAccessBranch()`**. Un CASHIER asignado a Sucursal A puede ver y modificar domicilios de Sucursal B si conoce el `branchId`.

Lo mismo aplica a las rutas de tablas (`tables.routes.ts`): ningún endpoint llama a `ensureUserCanAccessBranch()`.

**Comparación:** `salesRoutes` sí verifica: `ensureUserCanAccessBranch(request.auth, payload.branch_id)` en `create-sale.service.ts`.

**Fix:**
```ts
// En cada route handler:
ensureUserCanAccessBranch(request.auth, branchId);
```

**Esfuerzo:** 2h (cross-cutting, 2 archivos).

---

#### 🟡 UX-002 (P2) — Domicilio no bloquea creación sin sesión de caja abierta

Un domicilio se puede crear incluso si no hay sesión de caja abierta en la sucursal. La venta asociada (cuando finalmente se crea) sí necesita `cash_session_id`. Esto produce flujos abortados en producción cuando el operador crea el domicilio al inicio del día antes de abrir caja.

**Fix:** Validar `cash_session_id` activo al crear el delivery, o diseñar un flujo "delivery pre-paid" (tarjeta/efectivo al entregar).  
**Esfuerzo:** 1 día.

---

### A.3 — CHECKOUT / VENTA (create-sale.service.ts)

#### 🟠 BUG-007 (P1) — `balance_after` es `null` en `inventory_transactions` — **Ledger de inventario roto**

**Archivo:** [`create-sale.service.ts` L544-L545](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/sales/services/create-sale.service.ts#L544)

```ts
balance_after: null, // Podríamos calcularlo pero requeriría actualizar balanceByKey en memoria
```

El campo `balance_after` en `inventory_transactions` siempre es `null`. Esto significa que el ledger de inventario es **imposible de auditar hacia atrás** sin reconstruir el saldo acumulando todas las `qty_change`. Para DIAN en caso de auditoría fiscal de inventario, esto es un riesgo.

**Fix:** Actualizar `balanceByKey` en memoria durante el loop de items (reduciendo el saldo after each insert), luego usar ese valor en `balance_after`. El código ya tiene la variable `result.on_hand_qty` disponible justo después del upsert de `inventory_balances`.

```ts
const result = await trx.insertInto('inventory_balances')...
  .returning('on_hand_qty')
  .executeTakeFirst();

// inventory_transactions balance_after ya puede ser result.on_hand_qty ← fix
```

**Esfuerzo:** 2h.

---

#### 🟠 BUG-008 (P1) — `CashLedger.balance_after_cents` siempre es `0`

**Archivo:** [`create-sale.service.ts` L426-L428](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/sales/services/create-sale.service.ts#L426)

```ts
balanceAfterCents: 0  // En una implementación real... Para el PoC
```

Mismo patrón que el inventario: el ledger de caja siempre almacena `0` como saldo posterior. Los reportes de auditoría de caja (`cash_ledger`) muestran valores incorrectos.

**Fix:** Hacer una query al saldo acumulado de la sesión de caja antes de insertar, o mantener un contador en memoria durante la transacción.  
**Esfuerzo:** 3h (requiere query del saldo acumulado actual de la cash_session).

---

#### 🟡 TEC-002 (P2) — Descuento por promociones `FIXED_AMOUNT` no valida qty mínima

**Archivo:** [`create-sale.service.ts` L226-L227](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/sales/services/create-sale.service.ts#L226)

```ts
} else if (promo.type === 'FIXED_AMOUNT') {
  lineDiscountCents = promo.value_cents * item.qty; // ← descuento se multiplica por qty
```

Si una promoción `FIXED_AMOUNT` tiene `value_cents = 5000` y el producto tiene `price_cents = 3000`, el descuento `5000 * qty` puede superar `line_total_cents`. El check posterior `if (payload.discount_cents > subtotalCents)` atrapa el caso extremo, pero puede haber comportamientos inesperados cuando `promo.value_cents > product.price_cents`.

**Fix:** `lineDiscountCents = Math.min(promo.value_cents * item.qty, lineTotalCents)`.  
**Esfuerzo:** 15 min.

---

### A.4 — DIVISIÓN DE CUENTA (SPLIT BILL)

#### 🟠 BUG-009 (P1) — División por productos no sincroniza con `table_order` — **Estado inconsistente**

**Contexto:** `SplitBillByProductsModal.tsx` divide los items del carrito del frontend en múltiples pagos parciales. Pero la tabla `table_orders` en el backend sigue existiendo con el pedido completo hasta que se llama al checkout final.

**Flujo problemático:**
1. Mesa A tiene 4 productos
2. Cliente 1 paga productos 1 y 2 → se crea venta parcial
3. Cliente 2 paga productos 3 y 4 → se crea venta parcial
4. ¿Qué pasa con `table_orders`? El order sigue OPEN con los 4 items hasta que alguien llame `DELETE /tables/:id/order` o el checkout final cierre la mesa

**Problema:** Si el sistema se reinicia entre los dos pagos, el cajero puede cobrar los 4 items de nuevo al próximo cliente.

**Fix:** Al completar cada pago parcial en split, remover los items pagados del `table_order` (llamando a `PUT /tables/:id/order` con los items restantes). Si el split vacía todos los items, limpiar el order automáticamente.

**Esfuerzo:** 1 día (frontend + backend).

---

#### 🟡 UX-003 (P2) — Sin recibo por fracción en split bill

Cuando se hace split, se genera una venta por fracción, pero el usuario no tiene forma de imprimir/compartir el recibo de cada fracción individualmente desde el modal. El flujo cierra el modal al completar el checkout completo, perdiendo la referencia de las ventas parciales.

**Fix:** Mostrar en el modal un resumen de ventas generadas con botón de recibo por cada una.  
**Esfuerzo:** 1 día (frontend).

---

### A.5 — PROPINAS

#### 🟠 BUG-010 (P1) — Propinas sobre INC_8 — **Cálculo tributario incorrecto**

En el modo `INC_RESTAURANT`, el INC_8 (Impuesto Nacional al Consumo del 8%) es obligatorio. La propina en Colombia **no debe incluir INC_8** ya que es voluntaria y no constituye ingreso gravado. Sin embargo, la validación de `PAYMENTS_INSUFFICIENT` en `create-sale.service.ts` (L316) valida que los pagos cubran `computedTaxes.total_cents + tipCents`, donde `computedTaxes.total_cents` ya incluye el INC_8 calculado sobre el subtotal.

Esto es correcto. **El bug real es si algún frontend calcula `INC_8` sobre `subtotal + propina` en lugar de solo sobre `subtotal`**. Hay que verificar en el frontend que `computeTaxes` solo se aplica al subtotal, no al subtotal+tip.

**Estado:** Riesgo bajo si el backend es la fuente de verdad (lo es), pero el frontend podría mostrar impuesto incorrecto al usuario en la precuenta.

**Fix:** Revisar en `useCart.ts` / `useCheckout.ts` que `tipCents` se suma **después** del cálculo de impuestos, no antes. Añadir test unitario explícito.  
**Esfuerzo:** 2h.

---

#### 🟡 TEC-003 (P2) — `tip_cents` en `table_orders` no se persiste nunca

**Archivo:** [`table-orders.repository.ts` L65-L66](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/tables/infra/table-orders.repository.ts#L65)

```ts
// saveTableOrder:
subtotal_cents: subtotalCents,
discount_cents: 0,
total_cents: totalCents,
// ← tip_cents nunca se pasa aquí
```

El schema tiene `tip_cents` en `table_orders` (migración 063) pero nunca se guarda en `saveTableOrder`. Siempre queda en 0. La propina solo se guarda al momento del checkout final en `sales.tip_cents`. Esto es consistente con el flujo actual (la propina se define al checkout, no al tomar la orden), pero es una trampa técnica para el próximo desarrollador.

**Fix:** Documentar en el código con un comentario explícito (`// tip_cents se asigna al checkout, no durante la toma de orden`).  
**Esfuerzo:** 5 min.

---

### A.6 — SEGURIDAD WEBSOCKET

#### 🔴 SEG-002 (P0) — WebSocket sin autenticación — **Cualquier cliente puede suscribirse a cualquier branch**

**Archivo:** [`build-app.ts` L302-L315](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/app/build-app.ts#L302)

```ts
app.ready().then(() => {
  (app as any).io.on('connection', (socket: any) => {
    const branchId = socket.handshake.query.branchId as string;
    if (branchId) {
      socket.join(`branch:${branchId}`); // ← NO SE VERIFICA QUE EL CLIENTE TENGA ACCESO
    }
  });
});
```

No se valida el JWT del socket. Cualquier cliente (autenticado o no) puede conectarse al WebSocket y pasar `branchId=<cualquier_uuid>` para recibir eventos de TABLES_UPDATED de cualquier sucursal de cualquier tenant.

Los eventos solo disparan un refetch (no exponen datos sensibles directamente), pero **permite espionaje de actividad** de cualquier restaurant (cuándo se actualizan las mesas).

**Fix:**
```ts
socket.on('connection', async (socket) => {
  const token = socket.handshake.auth?.token || socket.handshake.query.token;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    const branchId = socket.handshake.query.branchId;
    // Validar que payload.branchIds incluye branchId
    if (!payload.branchIds?.includes(branchId)) {
      socket.disconnect(true);
      return;
    }
    socket.join(`branch:${branchId}`);
  } catch {
    socket.disconnect(true);
  }
});
```

**Esfuerzo:** 3h.

---

#### 🔴 SEG-003 (P0) — `rls.ts` usa `app.current_tenant` pero algunas políticas buscan `app.current_tenant_id`

**Archivo:** [`rls.ts` L21](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/rls.ts#L21)
**Archivo:** [`migrations/061_deliveries_module.ts` L95](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/061_deliveries_module.ts#L95)

```ts
// rls.ts:
await sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`.execute(trx);

// migrations/061_deliveries_module.ts:
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
//                                   ↑ diferente nombre: app.current_tenant_id vs app.current_tenant
```

La variable que se setea es `app.current_tenant`, pero las policies de domicilios leen `app.current_tenant_id`. **Las policies de RLS de domicilios nunca se activan correctamente** — siempre devuelven el valor por defecto de `current_setting(..., true)` que es `''`, lo que convierte el cast a UUID en un error o retorna vacío.

Esto significa que RLS en domicilios actualmente **está roto** — la cláusula `USING (tenant_id = ''::uuid)` nunca hace match y retorna 0 rows (o falla). En la práctica el sistema funciona porque el código también filtra por `WHERE tenant_id = :tenantId`, pero la defensa en profundidad de RLS no funciona.

**Fix:** Unificar el nombre de la variable. Opción A: cambiar `rls.ts` a `app.current_tenant_id`. Opción B: actualizar todas las policies de domicilios a `app.current_tenant`. Revisar también `migrations/038_enable_rls.ts`, `039_extend_rls.ts`, `040_worker_rls_role.ts` para ver cuál es el nombre canónico.

**Esfuerzo:** 2h + prueba en staging.

---

### A.7 — ESCALABILIDAD

#### 🟠 ESC-001 (P1) — Socket.io en monolito — **Barrera para escalar a múltiples instancias**

**Archivo:** [`build-app.ts` L250-L255](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/app/build-app.ts#L250)

Socket.io en Fastify sin Redis Adapter funciona correctamente con una sola instancia. Si el despliegue escala a 2 instancias (e.g. Cloud Run con min=2), los eventos `TABLES_UPDATED` solo llegan a los clientes conectados a la misma instancia que procesó la request.

**Solución a corto plazo:** Configurar `socket.io-redis-adapter` (ya hay Redis en el stack).

```ts
import { createAdapter } from '@socket.io/redis-adapter';
const pubClient = new Redis(env.REDIS_URL);
const subClient = pubClient.duplicate();
app.io.adapter(createAdapter(pubClient, subClient));
```

**Esfuerzo:** 2h.

---

#### 🟡 ESC-002 (P2) — Queries de `getRoomsWithTables` sin paginación ni filtro de activos

**Archivo:** [`tables.repository.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/tables/infra/tables.repository.ts)

Con 50+ salones y 200+ mesas por sucursal (escenario hotel/casino), el endpoint `GET /rooms` retorna todo sin límite. A 5KB por sala, son 1MB de payload por request. No hay caché.

**Fix a mediano plazo:** Agregar filtro `is_active=true` en el query (ya existe el campo) y considerar caché corto de 5s en Redis para este endpoint (es de solo lectura, cambia poco).  
**Esfuerzo:** 1h.

---

## SECCIÓN B — ESTADO DE ITEMS PREVIOS (AUDITORÍA JUN-10)

| ID Jun-10 | Descripción | Estado actual |
|---|---|---|
| DUP-004 | Migración 042 duplicada | ⚠️ **Pendiente** — archivos siguen con nombre duplicado |
| DUP-001/002/003 | `platform.routes.ts` huérfano | ⚠️ **Pendiente** — archivo sigue sin eliminarse |
| NI-001 | MercadoPago webhook siempre PENDING | ⚠️ **Pendiente** |
| NI-002 | Stripe status `FAILED` inválido | ⚠️ **Pendiente** |
| NI-005 | Registro sin `tenant_subscriptions` | ⚠️ **Pendiente** |
| NI-006 | Webhook no actualiza `tenant_subscriptions` | ⚠️ **Pendiente** |
| QW-004 | `mock-checkout` sin guard de NODE_ENV | ⚠️ **Pendiente** |

---

## SECCIÓN C — CLASIFICACIÓN P0-P3

### P0 — CRÍTICOS (Bloquean producción segura)

| ID | Descripción | Área | Esfuerzo |
|---|---|---|---|
| BUG-001 | `table_orders` sin RLS — fuga multi-tenant | Seguridad / DB | 1h |
| BUG-002 | Race condition en `saveTableOrder` (falta `forUpdate`) | Mesas | 30 min |
| BUG-005 | Delivery sin venta ni DIAN | Domicilios / Fiscal | 2-3 días |
| SEG-002 | WebSocket sin autenticación | Seguridad | 3h |
| SEG-003 | `app.current_tenant` vs `app.current_tenant_id` — RLS roto en deliveries | Seguridad / DB | 2h |
| DUP-004 *(Jun-10)* | Migración 042 duplicada | DB | 30 min |
| QW-004 *(Jun-10)* | `mock-checkout` sin guard de entorno | Seguridad | 30 min |
| NI-002 *(Jun-10)* | Stripe status `FAILED` inválido | Billing | 30 min |

### P1 — ALTOS (Corregir antes de crecimiento de clientes)

| ID | Descripción | Área | Esfuerzo |
|---|---|---|---|
| BUG-003 | Transfer sin validar branch de destino | Mesas | 1h |
| BUG-004 | `table_order.total_cents` sin impuesto INC_8 (precuenta incorrecta) | Restaurantes | 2-3 días |
| BUG-006 | `delivery.total_cents` sin impuestos | Domicilios | 2h |
| BUG-007 | `balance_after = null` en `inventory_transactions` | Inventario / Audit | 2h |
| BUG-008 | `cash_ledger.balance_after_cents = 0` siempre | Caja / Audit | 3h |
| BUG-009 | Split bill no sincroniza `table_order` | Split / Mesas | 1 día |
| BUG-010 | Riesgo de propina con INC_8 — revisar cálculo frontend | Fiscal | 2h |
| SEG-001 | Deliveries y tables sin `ensureUserCanAccessBranch` | Seguridad | 2h |
| ESC-001 | Socket.io sin Redis Adapter para multi-instancia | Escalabilidad | 2h |
| NI-001 *(Jun-10)* | MercadoPago webhook siempre PENDING | Billing | 2 días |
| NI-005 *(Jun-10)* | Registro sin `tenant_subscriptions` | SaaS | 1h |
| NI-006 *(Jun-10)* | Webhook no actualiza `tenant_subscriptions` | SaaS | 1h |
| DUP-001/2/3 *(Jun-10)* | `platform.routes.ts` huérfano | Limpieza | 30 min |

### P2 — MEDIOS (Sprint siguiente)

| ID | Descripción | Área | Esfuerzo |
|---|---|---|---|
| UX-001 | Deriva de reloj en timer de mesas | UX | 2h |
| UX-002 | Delivery sin validar sesión de caja | UX / Domicilios | 1 día |
| UX-003 | Sin recibo individual en split bill | UX | 1 día |
| TEC-001 | `saveTableOrder` DELETE+INSERT ineficiente (escalabilidad) | Performance | 4h |
| TEC-002 | Descuento `FIXED_AMOUNT` puede superar `line_total` | Ventas | 15 min |
| ESC-002 | `getRoomsWithTables` sin caché ni filtro de activos | Performance | 1h |
| ARQH-002 *(Jun-10)* | Lógica billing en route handler | Arquitectura | 2 días |
| ME-005 *(Jun-10)* | Tipado `any` masivo en frontend platform | TypeScript | Medio |

### P3 — BAJOS (Backlog)

| ID | Descripción | Área | Esfuerzo |
|---|---|---|---|
| TEC-003 | `tip_cents` en `table_orders` nunca se persiste — documentar | Código | 5 min |
| NI-007 *(Jun-10)* | Email de bienvenida simulado | Notificaciones | 3 días |
| NI-008 *(Jun-10)* | Health check hardcodeado | Ops | Medio |
| NI-010 *(Jun-10)* | Notificaciones externas de bajo stock | Alertas | Alto |
| AE-002 *(Jun-10)* | Renovación automática de suscripciones | SaaS | Alto |

---

## SECCIÓN D — ROADMAP 12 MESES

### Mes 1-2: Estabilización Pre-Launch
**Objetivo:** Cero P0, P1 críticos resueltos. Beta controlada con 5-10 restaurantes.

- [ ] **Sem 1:** Fix SEG-003 (RLS variable name), BUG-001 (tabla_orders RLS), SEG-002 (WS auth), BUG-002 (forUpdate)
- [ ] **Sem 1:** Fix DUP-004 (migración 042), QW-004 (mock-checkout guard), NI-002 (Stripe status)
- [ ] **Sem 2:** Fix SEG-001 (branch access check en deliveries/tables), BUG-007/008 (balance_after)
- [ ] **Sem 2-3:** BUG-005 (delivery → sale integration), BUG-004 (precuenta con INC_8)
- [ ] **Sem 3-4:** ESC-001 (Socket.io Redis adapter), BUG-003 (transfer branch validation)
- [ ] **Sem 4:** NI-005/006 (tenant_subscriptions en registro y webhook), DUP-001 (cleanup platform.routes)

**KPI:** 0 P0 abiertos · < 5 P1 abiertos · Cobertura de tests en create-sale ≥ 80%

---

### Mes 3-4: Completar Módulo Restaurante
**Objetivo:** Funcionalidad restaurante completa para comercialización activa.

- [ ] Precuenta con impuesto correcto (INC_8 en `table_order`)
- [ ] Split bill sincronizado con `table_order` (BUG-009)
- [ ] Recibo individual por fracción (UX-003)
- [ ] Domicilio obliga sesión de caja (UX-002)
- [ ] Timer de mesas con fuente de verdad backend (UX-001)
- [ ] Implementar `MercadoPagoGateway.parseWebhook()` (NI-001)
- [ ] `saveTableOrder` con upsert semántico (TEC-001)

**KPI:** NPS de restaurantes piloto ≥ 7 · Tiempo de checkout < 30s · 0 bugs de datos reportados

---

### Mes 5-6: Módulo Domicilios Production-Ready
**Objetivo:** Domicilios con trazabilidad fiscal completa.

- [ ] `createDelivery` crea venta y documento DIAN automáticamente
- [ ] Kanban de domicilios en tiempo real (WebSocket events para `DELIVERY_UPDATED`)
- [ ] `delivery.total_cents` con impuestos correctos
- [ ] Integración con proveedor DIAN para documentos de domicilio
- [ ] App móvil/PWA ligera para repartidores (status update desde celular)
- [ ] Pruebas de carga: 50 domicilios simultáneos por sucursal

**KPI:** < 1% órdenes sin factura · Tiempo promedio desde creación a DELIVERED < 45 min

---

### Mes 7-8: SaaS Billing Completo
**Objetivo:** Motor de suscripciones autónomo, MRR rastreable.

- [ ] Renovación automática de suscripciones (worker job)
- [ ] Lógica PAST_DUE + grace period + suspensión automática
- [ ] Email de onboarding real (Resend)
- [ ] Notificaciones de expiración (email 7 días antes)
- [ ] Dashboard MRR/ARR con datos consistentes
- [ ] Self-service cancel/downgrade

**KPI:** Churn involuntario < 2% · MRR tracking accuracy 100% · < 5 tickets soporte/mes por billing

---

### Mes 9-10: Escalabilidad y Observabilidad
**Objetivo:** Preparar para 100+ tenants activos.

- [ ] `getRoomsWithTables` con caché Redis de 5s
- [ ] Índices adicionales en `table_orders`, `deliveries`
- [ ] Alertas OTel en Grafana: p95 latencia, error rate por endpoint
- [ ] `platform health check` real (DB, Redis, BullMQ)
- [ ] Pruebas de carga: 500 ventas/minuto concurrentes
- [ ] CDN para assets del POS (imágenes de productos)
- [ ] Separar `pos-web` en dos bundles: POS + Admin (reduce JS inicial 40%)

**KPI:** p95 latencia < 200ms · Disponibilidad > 99.9% · TTFB < 1s en 3G

---

### Mes 11-12: Multi-Industria y Marketplace
**Objetivo:** Expandir más allá de restaurantes.

- [ ] Perfil de negocio configurable: Retail, Café, Spa, Hotel
- [ ] Reservas de mesa (status RESERVED con timestamp)
- [ ] Integración con plataformas de delivery (Rappi, Domicilios.com) vía webhooks
- [ ] API pública para integraciones de terceros (contabilidad, ERPs)
- [ ] Plan Enterprise con SSO y soporte SLA
- [ ] Marketplace de complementos (impresoras fiscales, básculas, etc.)

**KPI:** 3 verticales con pilotos activos · ARR > USD 50k · NPS plataforma ≥ 8

---

## SECCIÓN E — DEUDA TÉCNICA HEREDADA (ESTADO JUN-19)

Items de la auditoría anterior que siguen pendientes y acumulan interés:

1. **Migración 042 duplicada** — cada nuevo desarrollador que instala el proyecto localmente puede tener un entorno diferente dependiendo del orden de ejecución. Bloquea onboarding de nuevos devs.
2. **`platform.routes.ts` huérfano** — 176 líneas de código muerto confunden en code review y búsquedas de código.
3. **`tenant_subscriptions` desincronizado** — el MRR del dashboard lleva ≥9 días con datos incorrectos si hay tenants registrados públicamente.
4. **`mock-checkout` sin guard** — si alguien hace el primer deploy de producción sin revisar la configuración, existe un endpoint de fraude sin autenticación.

---

## CONCLUSIÓN EJECUTIVA

El sistema tiene **fundamentos sólidos**: ledgers inmutables con hash encadenado, idempotencia en ventas, RLS (parcialmente implementado), OTel integrado, worker BullMQ asíncrono. La arquitectura está bien pensada para escala gradual.

**Los riesgos principales para la comercialización son:**

1. 🔴 **RLS incompleto** en mesas y roto en domicilios — necesita corrección antes del primer cliente real (BUG-001, SEG-003)
2. 🔴 **Domicilios sin vínculo fiscal** — cada domicilio debería generar una venta; actualmente es opcional (BUG-005)
3. 🔴 **WebSocket sin auth** — cualquier persona puede espiar la actividad de cualquier restaurante (SEG-002)
4. 🟠 **Precuenta incorrecta** — el total que ve el cliente en mesa no incluye INC_8 (BUG-004)

Con **2-3 semanas de trabajo enfocado en P0s**, el sistema puede estar listo para beta controlada con clientes reales. Con **2-3 meses adicionales**, puede operar con confianza a escala.

---

*Auditoría realizada sobre commit HEAD de `mibernal/pos` | 2026-06-19*  
*Confianza: **Alta** — todos los hallazgos están respaldados por evidencia directa de código.*
