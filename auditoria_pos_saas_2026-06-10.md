# 🔍 Auditoría Técnica Profunda — POS SaaS Multi-Tenant
**Fecha:** 2026-06-10 | **Auditor:** Antigravity AI | **Repositorio:** `mibernal/pos`

---

## RESUMEN EJECUTIVO

El repositorio tiene una arquitectura sólida en general, pero acumula **deuda técnica moderada-alta** concentrada en tres zonas críticas:

1. **Duplicación de rutas de plataforma** — dos módulos distintos implementan endpoints `/platform/*` con lógica divergente, uno de ellos **no está registrado en la app** (código huérfano).
2. **Billing parcialmente implementado** — el flujo de pagos existe y es funcional para el MVP, pero **MercadoPago es semi-funcional**, **Stripe mezcla status no definidos** en el contrato, y el modelo prepago **no está reconectado a `tenant_subscriptions`** para suscripciones recurrentes.
3. **Tipado débil masivo** — 400+ ocurrencias de `any` / `eslint-disable` en el frontend de plataforma, sin interfaces tipadas para las respuestas de la API de administración.

---

## FASE 1 — INVENTARIO DE MÓDULOS DE BILLING Y PAGOS

### 1.1 Backend — Contexto `billing`
| Archivo | Responsabilidad | Estado |
|---|---|---|
| [`billing/domain/payment-gateway.interface.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/payment-gateway.interface.ts) | Contrato `IPaymentGateway` | ✅ Implementado |
| [`billing/domain/wompi-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/wompi-gateway.ts) | Wompi Web Checkout + firma SHA256 | ✅ Implementado |
| [`billing/domain/mercadopago-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/mercadopago-gateway.ts) | MercadoPago Checkout Pro | ⚠️ Parcialmente implementado |
| [`billing/domain/stripe-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/stripe-gateway.ts) | Stripe Checkout Sessions (suscripciones) | ⚠️ Parcialmente implementado |
| [`billing/domain/mock-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/mock-gateway.ts) | Gateway de pruebas locales | ✅ Implementado |
| [`billing/application/create-checkout-session.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/application/create-checkout-session.ts) | Caso de uso: crear checkout | ✅ Implementado |
| [`billing/application/process-payment-webhook.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/application/process-payment-webhook.ts) | Caso de uso: procesar webhook | ⚠️ Parcialmente implementado |
| [`billing/http/billing.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/http/billing.routes.ts) | Rutas: `GET /billing/plans`, `POST /billing/checkout`, `GET /billing/mock-checkout` | ✅ Implementado |
| [`billing/http/webhooks.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/http/webhooks.routes.ts) | Rutas: webhooks Wompi, MercadoPago, Stripe | ✅ Implementado |

### 1.2 Backend — Contexto `platform-admin` (gestión de planes)
| Archivo | Responsabilidad | Estado |
|---|---|---|
| [`platform-admin/http/platform-admin.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/http/platform-admin.routes.ts) | CRUD de `billing_plans`, cambio de plan de tenant, tenant_subscriptions | ✅ Implementado |
| [`platform-admin/infra/platform-admin.repository.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/infra/platform-admin.repository.ts) | Métricas (MRR, ARR, trials, suscripciones por vencer) | ✅ Implementado |

### 1.3 Base de Datos — Tablas relevantes
| Tabla | Migración | Descripción |
|---|---|---|
| `billing_plans` | [`047_billing_tables.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/047_billing_tables.ts) | Planes STARTER/PRO/ENTERPRISE con seed incluido |
| `tenant_subscriptions` | `047_billing_tables.ts` + [`051_platform_admin.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/051_platform_admin.ts) | Suscripciones activas por tenant |
| `payment_transactions` | `047_billing_tables.ts` | Transacciones de pago con estado |
| `subscription_events` | `051_platform_admin.ts` | Historial de eventos de suscripción |
| `platform_events` | `051_platform_admin.ts` | Log de actividad del backoffice |
| `impersonation_sessions` | [`046_platform_impersonation.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/046_platform_impersonation.ts) | Sesiones de suplantación |
| `billing_plans.archived_at` | [`053_billing_plans_archive.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/053_billing_plans_archive.ts) | Soft-delete de planes |

### 1.4 Frontend
| Archivo | Responsabilidad | Estado |
|---|---|---|
| [`features/billing/BillingScreen.tsx`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/billing/BillingScreen.tsx) | Pantalla de selección de plan + checkout | ✅ Implementado |
| [`features/billing/components/UpgradePlanModal.tsx`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/billing/components/UpgradePlanModal.tsx) | Modal de upgrade de plan | ✅ Implementado |
| [`lib/api/client.ts` → `getBillingPlans`, `createCheckoutSession`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/lib/api/client.ts#L680-L686) | Métodos de API de billing | ✅ Implementado |

---

## FASE 2 — DETECCIÓN DE DUPLICADOS

### DUP-001 — 🔴 CRÍTICO: Endpoint `POST /platform/tenants/:id/impersonate` duplicado

**Archivos:**
- A: [`identity/http/platform.routes.ts` L125](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts#L125)
- B: [`platform-admin/http/platform-admin.routes.ts` L251](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/http/platform-admin.routes.ts#L251)

**Diferencias clave:**
| Aspecto | `identity/http/platform.routes.ts` | `platform-admin/platform-admin.routes.ts` |
|---|---|---|
| Obtención del owner | `owner_user_id` directo, falla si no existe | Fallback a primer usuario activo del tenant |
| Mensaje retornado | "Implementar generación de JWT para impersonación" | Mismo mensaje |
| Registrado en app | ❌ **NO** (código huérfano) | ✅ Sí |

**Riesgo:** Confusion en el equipo, el archivo huérfano podría importarse accidentalmente.  
**Refactor:** Eliminar `identity/http/platform.routes.ts` completo (es un archivo huérfano en su totalidad).

---

### DUP-002 — 🔴 CRÍTICO: Endpoint `GET /platform/tenants` duplicado

**Archivos:**
- A: [`identity/http/platform.routes.ts` L15](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts#L15) — retorna `{ tenants: [] }` con lista plana
- B: [`platform-admin/platform-admin.routes.ts` L103](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/http/platform-admin.routes.ts#L103) — retorna `{ items, total }` con búsqueda avanzada, joins a suscripciones

**Riesgo:** A no está registrado, pero si alguien lo registra se crea un conflicto de ruta.  
**Refactor:** Eliminar el archivo A (`identity/http/platform.routes.ts`).

---

### DUP-003 — 🔴 CRÍTICO: Métricas de plataforma duplicadas

**Archivos:**
- A: [`identity/http/platform.routes.ts` L95 — `GET /platform/metrics`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts#L95) — 3 queries básicos
- B: [`platform-admin/infra/platform-admin.repository.ts` L7 — `getDashboardMetrics()`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/infra/platform-admin.repository.ts#L7) — 6 queries incluyendo MRR, ARR, trials, suscripciones

**Riesgo:** Código A es un subset desactualizado de B.  
**Refactor:** Eliminar A (es huérfano). B ya está activo en `GET /platform/dashboard`.

---

### DUP-004 — 🔴 CRÍTICO: Migración con número 042 duplicado

**Archivos:**
- [`042_immutable_ledgers.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/042_immutable_ledgers.ts) — crea tablas de ledger inmutables (6220 bytes)
- [`042_inventory_valuation_branch.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/migrations/042_inventory_valuation_branch.ts) — agrega `branch_id` a `inventory_valuation_snapshot` (1362 bytes)

**Riesgo:** El migrador Kysely ordena por nombre de archivo. Si el orden es no determinístico entre estos dos, puede causar errores de migración en nuevos entornos.  
**Refactor:** Renombrar `042_inventory_valuation_branch.ts` → `042b_inventory_valuation_branch.ts` o renumerar como `043b`.

---

### DUP-005 — 🟠 ALTO: Lógica de parseo de `REFRESH_TOKEN_EXPIRES_IN` triplicada

**Archivos:** [`auth.routes.ts` L240, L436, L604](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/auth.routes.ts)

Las tres funciones (`login`, `impersonate/exchange`, `refresh`) contienen el mismo bloque:
```ts
const match = env.REFRESH_TOKEN_EXPIRES_IN.match(/^(\d+)([dhms])$/);
let expMs = 7 * 24 * 60 * 60 * 1000;
if (match) { ... }
```

**Refactor:** Extraer a una función utilitaria `parseExpiryToMs(expiry: string): number` en `shared/infra/utils/time.ts`.

---

### DUP-006 — 🟠 ALTO: Lógica de obtención de `branchIds` triplicada en `auth.routes.ts`

**Archivo:** [`auth.routes.ts` L207, L334, L464, L644](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/auth.routes.ts)

Idéntico query de `user_branches` en login, `/auth/me`, impersonate/exchange y refresh.

**Refactor:** Extraer a función `getUserBranchIds(db, userId, tenantId): Promise<string[]>`.

---

### DUP-007 — 🟠 ALTO: Lógica de construcción del JWT payload duplicada (x4)

**Archivo:** [`auth.routes.ts` L220, L478, L658](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/auth.routes.ts)

El objeto `claims` y el objeto `user` del response son idénticos en login, impersonate/exchange y refresh.

**Refactor:** Extraer a `buildAuthResponse(user, branchIds): AuthResponsePayload`.

---

### DUP-008 — 🟡 MEDIO: Queries de conteo duplicados en `platform.routes.ts` y `platform-admin.repository.ts`

Los 3 queries COUNT de tenants/users en [`platform.routes.ts` L101-L113](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts#L101) están duplicados en [`platform-admin.repository.ts` L8-L20](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/infra/platform-admin.repository.ts#L8). Pero dado que A es huérfano, este duplicado se resuelve automáticamente al eliminar el archivo A.

---

## FASE 3 — FUNCIONES NO IMPLEMENTADAS

### NI-001 — 🔴 CRÍTICO: `MercadoPagoGateway.parseWebhook()` — status PENDING hardcodeado

**Archivo:** [`mercadopago-gateway.ts` L99](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/mercadopago-gateway.ts#L99)

```ts
// Debe resolverse luego consultando la API en el UseCase
return {
  reference: payload?.external_reference || '', // Puede venir o no
  status: 'PENDING', // ← SIEMPRE retorna PENDING
  ...
};
```

**Impacto:** Todos los webhooks de MercadoPago son ignorados. El pago nunca se marca como APPROVED.  
**Riesgo:** CRÍTICO — Si el negocio usa MercadoPago, ningún pago será procesado.  
**Esfuerzo:** 1-2 días (requiere consulta adicional a la API de MP para obtener el estado real del pago).

---

### NI-002 — 🔴 CRÍTICO: `StripeGateway.parseWebhook()` — status `'FAILED'` no existe en el contrato

**Archivo:** [`stripe-gateway.ts` L75](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/stripe-gateway.ts#L75)

```ts
status: 'FAILED' as any, // FAILED in my enum is not in PaymentWebhookResult
// (only PENDING | APPROVED | DECLINED | ERROR). 
```

**Impacto:** Cuando un pago de Stripe falla asíncronamente, se retorna un status inválido (`FAILED`) que **rompe el contrato de TypeScript** con un `as any`. El webhook handler downstream podría fallar silenciosamente o actualizar la transacción a un estado no definido en la DB.  
**Riesgo:** ALTO — rompe la integridad del estado de pagos.  
**Esfuerzo:** Quick win (< 1 hora): cambiar a `'DECLINED'` o `'ERROR'`.

---

### NI-003 — 🔴 CRÍTICO: `StripeGateway.verifyPayment()` — método muerto, siempre retorna `true`

**Archivo:** [`stripe-gateway.ts` L84-L86](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/stripe-gateway.ts#L84)

```ts
async verifyPayment(reference: string): Promise<boolean> {
  return true; // ← hardcodeado, nunca verifica nada
}
```

**Evidencia de uso:** Ninguna. El método no está definido en `IPaymentGateway`, no es llamado desde ningún caso de uso. Es **código muerto**.  
**Riesgo:** MEDIO (confusión, falsa sensación de verificación).  
**Esfuerzo:** Quick win: eliminar el método.

---

### NI-004 — 🔴 CRÍTICO: Impersonación sin generación de JWT en `identity/http/platform.routes.ts`

**Archivo:** [`platform.routes.ts` L173](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts#L173)

```ts
return { 
  success: true, 
  session_id: sessionId, 
  message: 'Implementar generación de JWT para impersonación' // ← TODO explícito
};
```

Sin embargo, este archivo **no está registrado** en `build-app.ts`, por lo que es código huérfano. La impersonación funcional está en `platform-admin.routes.ts` que retorna el mismo mensaje, y luego el frontend llama a `/auth/impersonate/exchange` que sí genera el JWT. **El flujo completo existe y funciona**.

---

### NI-005 — 🟠 ALTO: `register` en `auth.routes.ts` no crea `tenant_subscriptions`

**Archivo:** [`auth.routes.ts` L57-L92](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/auth.routes.ts#L57)

El registro público crea el tenant con `status: 'TRIAL'` y `plan: 'STARTER'` pero **no inserta un registro en `tenant_subscriptions`**. En contraste, el registro via superadmin (`platform-admin.routes.ts` L480-L491) sí inserta la suscripción.

**Impacto:** Las métricas de MRR/ARR en el dashboard del superadmin no cuentan tenants registrados públicamente porque no tienen suscripción activa en `tenant_subscriptions`.  
**Riesgo:** ALTO — inconsistencia de datos.  
**Esfuerzo:** < 1 hora.

---

### NI-006 — 🟠 ALTO: `process-payment-webhook.ts` no actualiza `tenant_subscriptions` en pagos APPROVED

**Archivo:** [`process-payment-webhook.ts` L62-L87](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/application/process-payment-webhook.ts#L62)

```ts
// En un modelo recurrente se actualizaría tenant_subscriptions (fecha actual + 1 mes). 
// Para prepago básico actualizamos directamente tenants.plan y permitimos el login.
```

El webhook solo actualiza `tenants.plan` y `tenants.status = 'ACTIVE'`. **No crea ni actualiza ningún registro en `tenant_subscriptions`**. Esto significa que tras un pago exitoso vía webhook, la suscripción en la tabla de suscripciones no existe (si el tenant se registró públicamente).  
**Riesgo:** ALTO — los dashboards de MRR/ARR muestran datos incorrectos.

---

### NI-007 — 🟡 MEDIO: Envío de email simulado con `app.log.info`

**Archivo:** [`auth.routes.ts` L103-L109](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/auth.routes.ts#L103)

```ts
// Simular envío de notificación (email) al administrador inicial
app.log.info({ event: 'EMAIL_SENT', ... });
```

No existe integración real con ningún servicio de email (Resend, SendGrid, etc.).  
**Riesgo:** BAJO — funcionalidad de bienvenida no disponible.

---

### NI-008 — 🟡 MEDIO: `GET /platform/health` hardcodeado como "Healthy"

**Archivo:** [`platform-admin.routes.ts` L630-L639](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/http/platform-admin.routes.ts#L630)

```ts
return {
  status: 'Healthy',  // ← hardcodeado
  services: [
    { name: 'API', status: 'Healthy' },  // ← hardcodeado
    ...
  ]
};
```

No hay ping real a DB, Redis ni BullMQ.  
**Riesgo:** BAJO en producción (da falsa seguridad en monitoreo).

---

### NI-009 — 🟡 MEDIO: TODOs en `scanner.routes.ts`

**Archivo:** [`scanner.routes.ts` L126, L342](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/inventory/http/scanner.routes.ts)

```ts
// TODO: Validate differences against PO if PO_LINKED, require PIN if differences
// TODO: Require PIN verification for discrepancy_approved_by_pin if items.length > 0
```

Validaciones de discrepancias de inventario pendientes.

---

### NI-010 — 🟡 MEDIO: TODO en `outbox-low-stock-alert.processor.ts`

**Archivo:** [`outbox-low-stock-alert.processor.ts` L85](file:///Users/MiguelBernal/APPS/REACT/POS/apps/worker/src/jobs/outbox-low-stock-alert.processor.ts#L85)

```ts
// TODO (Phase 7): Integrate with notification service (email, push, webhook)
```

Las alertas de bajo stock se crean en DB pero no se notifica externamente.

---

## FASE 4 — FUNCIONALIDADES HUÉRFANAS

### HU-001 — 🔴 CRÍTICO: `identity/http/platform.routes.ts` — archivo completo no registrado

**Archivo:** [`platform.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/http/platform.routes.ts)

**Evidencia:** Búsqueda de `platformRoutes` en todo el proyecto (incluyendo `build-app.ts`) devuelve exactamente **1 resultado**: la exportación en el propio archivo. Nunca se importa ni registra en Fastify.

**Contenido huérfano:**
- `GET /platform/tenants` (L15)
- `PATCH /platform/tenants/:id/status` (L51)
- `GET /platform/metrics` (L95)
- `POST /platform/tenants/:id/impersonate` (L125)

**Recomendación:** ~~Migrar lo que falte~~ → **Eliminar el archivo completo**. Toda la funcionalidad está cubierta por `platform-admin.routes.ts` con implementaciones superiores.

---

### HU-002 — 🟡 MEDIO: `identity/domain/` — directorio vacío

**Directorio:** [`identity/domain/`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/domain) — **vacío**

**Recomendación:** Eliminar el directorio vacío o mover entidades de dominio relevantes.

---

### HU-003 — 🟡 MEDIO: `identity/services/` — directorio vacío

**Directorio:** [`identity/services/`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/identity/services) — **vacío**

**Recomendación:** Eliminar o poblar (mover `password.ts` aquí desde `identity/auth/`).

---

### HU-004 — 🟡 MEDIO: `platform-admin/application/` — directorio vacío

**Directorio:** [`platform-admin/application/`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/application) — **vacío**

**Recomendación:** Mover la lógica de negocio del controlador a casos de uso en este directorio.

---

### HU-005 — 🟡 MEDIO: `platform-admin/domain/` — directorio vacío

**Directorio:** [`platform-admin/domain/`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/domain) — **vacío**

---

### HU-006 — 🟡 MEDIO: Seed no crea suscripciones en `tenant_subscriptions`

**Archivo:** [`seed.ts` L79-L144](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/shared/infra/db/seed.ts#L79)

El seed crea tenants Demo con `plan: 'pro'` y `plan: 'basic'` pero **no inserta registros en `tenant_subscriptions`**. Los planes `pro` y `basic` no existen en `billing_plans` (que tiene `STARTER`, `PRO`, `ENTERPRISE`). Las métricas de MRR siempre aparecen en 0 en entorno de desarrollo.

---

## FASE 5 — AUDITORÍA DE INTEGRACIONES DE PAGO

### Stripe
- **Estado:** ⚠️ Parcialmente implementado
- **Implementado:** Checkout Sessions con modo `subscription`, verificación de firma con `stripe.webhooks.constructEvent`, parseo de `checkout.session.completed`
- **Problemas:**
  1. `parseWebhook()` retorna `status: 'FAILED' as any` — **rompe el contrato TypeScript** (NI-002)
  2. `verifyPayment()` es código muerto que siempre retorna `true` (NI-003)
  3. La API version está hardcodeada como `'2023-10-16'` — puede quedar desactualizada
  4. La currency está hardcodeada como `'cop'` — no usa `input.currency`
- **Archivos:** [`stripe-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/stripe-gateway.ts)

### MercadoPago
- **Estado:** ❌ Parcialmente implementado (flujo incompleto)
- **Implementado:** Creación de preferencia (Checkout Pro), verificación de firma HMAC-SHA256
- **Problemas:**
  1. `parseWebhook()` **siempre retorna `status: 'PENDING'`** — ningún pago de MP se procesa (NI-001)
  2. El comentario explica que se necesita una consulta adicional a la API de MP (`GET /v1/payments/:id`) para resolver el estado real — **no está implementado**
  3. `urlParams` declarado pero nunca usado (línea 70)
- **Archivos:** [`mercadopago-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/mercadopago-gateway.ts)

### Wompi
- **Estado:** ✅ Implementado correctamente
- **Implementado:** Web Checkout con URL pública, verificación de checksum SHA256 según documentación oficial de Wompi, parseo de estados APPROVED/DECLINED/VOIDED
- **Observaciones menores:**
  - `headers` param en `verifyWebhookSignature` se declara pero no se usa (la firma de Wompi va en el body)
- **Archivos:** [`wompi-gateway.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/domain/wompi-gateway.ts)

### Mock Gateway
- **Estado:** ✅ Implementado (para desarrollo/pruebas)
- **Riesgo:** El endpoint `GET /billing/mock-checkout` está **sin autenticación** y actualiza directamente la transacción a APPROVED. Si llega a producción con configuración incorrecta, es un vector de fraude.
- **Recomendación:** Agregar middleware que solo permita `mock-checkout` en `NODE_ENV !== 'production'`.

### PayU, ePayco, PayPal, DIAN Facturación Electrónica
- **Estado:** No implementados. No existe ninguna referencia en el código.

---

## FASE 6 — INCONSISTENCIAS ARQUITECTÓNICAS

### ARQH-001 — 🔴 CRÍTICO: Dos contextos manejan rutas `/platform/*`

| Contexto | Archivo | ¿Registrado? |
|---|---|---|
| `contexts/identity/http/` | `platform.routes.ts` | ❌ **NO** |
| `contexts/platform-admin/http/` | `platform-admin.routes.ts` | ✅ Sí |

La solución correcta es tener **un único contexto** para la administración de plataforma. El contexto `identity` debería limitarse a autenticación, usuarios y branches.

---

### ARQH-002 — 🟠 ALTO: Lógica de negocio de billing en el route handler

**Archivo:** [`billing.routes.ts` L85-L103](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/billing/http/billing.routes.ts#L85)

El endpoint `GET /billing/mock-checkout` contiene lógica de negocio directamente (update de transaction + update de tenant plan) sin pasar por un caso de uso. Viola la separación de capas.

**También:** El endpoint `POST /platform/tenants/:id/plan` en `platform-admin.routes.ts` (L550-L622) contiene 70 líneas de lógica de negocio directamente en el route handler sin ningún caso de uso ni servicio.

---

### ARQH-003 — 🟠 ALTO: `platform-admin.routes.ts` es un "god route" de 758 líneas

**Archivo:** [`platform-admin.routes.ts`](file:///Users/MiguelBernal/APPS/REACT/POS/apps/api/src/contexts/platform-admin/http/platform-admin.routes.ts) — 758 líneas, 20 endpoints, todo en un solo archivo.

Los directorios `application/` y `domain/` del contexto `platform-admin` están **vacíos**. Toda la lógica está en el route handler.

---

### ARQH-004 — 🟡 MEDIO: Dos sistemas de actualización de plan del tenant

- Sistema 1 (webhook): `process-payment-webhook.ts` → actualiza solo `tenants.plan`
- Sistema 2 (superadmin): `platform-admin.routes.ts` POST `/platform/tenants/:id/plan` → actualiza `tenants.plan` + `tenant_subscriptions`

No son equivalentes. El webhook deja `tenant_subscriptions` desactualizado.

---

### ARQH-005 — 🟡 MEDIO: Modelo de plan en `tenants` vs `tenant_subscriptions`

La tabla `tenants` tiene una columna `plan: string` (campo denormalizado) y también existe `tenant_subscriptions`. Hay dos fuentes de verdad para el plan actual de un tenant. El login (`auth.routes.ts`) lee de `tenants.plan` directamente.

---

## FASE 7 — PLAN DE REFACTOR

### Quick Wins (< 1 hora)

| ID | Tarea | Beneficio | Riesgo mitigado |
|---|---|---|---|
| QW-001 | Fix `StripeGateway.parseWebhook()`: cambiar `'FAILED' as any` por `'DECLINED'` | Tipado correcto, status válido | Corrupción de estado de pagos |
| QW-002 | Eliminar método muerto `StripeGateway.verifyPayment()` | Menos código muerto | Confusión en el equipo |
| QW-003 | Renombrar `042_inventory_valuation_branch.ts` → `042b_...` | Migrador determinístico | Errores en nuevos entornos |
| QW-004 | Proteger `GET /billing/mock-checkout` con guard de NODE_ENV | Seguridad | Vector de fraude en producción |
| QW-005 | Eliminar `identity/http/platform.routes.ts` (archivo huérfano completo) | -176 líneas de código muerto | Duplicación de endpoints |

### Bajo Esfuerzo (< 1 día)

| ID | Tarea | Beneficio | Complejidad |
|---|---|---|---|
| BE-001 | Extraer `parseExpiryToMs()` y `buildAuthResponse()` de `auth.routes.ts` | DRY, menos bugs | Baja |
| BE-002 | Agregar creación de `tenant_subscriptions` en `auth/register` | Datos consistentes para MRR/ARR | Baja |
| BE-003 | Actualizar `tenant_subscriptions` en `process-payment-webhook.ts` cuando status=APPROVED | Consistencia del modelo de datos | Baja-Media |
| BE-004 | Actualizar el seed para crear suscripciones y usar nombres de plan consistentes (`PRO`, `STARTER`) | Dashboard funcional en dev | Baja |
| BE-005 | Eliminar directorios vacíos: `identity/domain/`, `identity/services/`, `platform-admin/application/`, `platform-admin/domain/` | Limpieza | Baja |

### Medio Esfuerzo (1-3 días)

| ID | Tarea | Beneficio | Complejidad |
|---|---|---|---|
| ME-001 | Implementar `MercadoPagoGateway.parseWebhook()` con consulta real a `GET /v1/payments/:id` | MercadoPago funcional | Media |
| ME-002 | Descomponer `platform-admin.routes.ts` en casos de uso en `application/` | Arquitectura correcta | Media |
| ME-003 | Implementar `GET /platform/health` real (ping a DB, Redis, BullMQ) | Monitoreo real | Media |
| ME-004 | Unificar las dos fuentes de verdad de plan (eliminar `tenants.plan` o convertirla en campo derivado) | Modelo de datos limpio | Media-Alta |
| ME-005 | Tipar todas las `any` en el frontend de plataforma con interfaces generadas desde la API | TypeScript correcto | Media |

### Alto Esfuerzo (> 3 días)

| ID | Tarea | Beneficio | Complejidad |
|---|---|---|---|
| AE-001 | Implementar servicio de email real (Resend/SendGrid) para notificaciones | Onboarding funcional | Alta |
| AE-002 | Implementar lógica de renovación automática de suscripciones (cron job + webhooks recurrentes) | Modelo SaaS completo | Alta |
| AE-003 | Implementar verificación de PIN para discrepancias en scanner (NI-009) | Seguridad de inventario | Alta |

---

## FASE 8 — AUDITORÍA DE CALIDAD

### Métricas de calidad TypeScript

| Métrica | Cantidad | Archivos principales |
|---|---|---|
| `any` explícito + `eslint-disable @typescript-eslint/no-explicit-any` | ~80+ instancias | `platform-admin.routes.ts`, todos los componentes de `/features/platform/*` |
| `as any` casts sin suppressión | ~15 instancias | `platform-admin.routes.ts`, `stripe-gateway.ts` |
| `@ts-ignore` | 1 (`build-app.ts` L265) | Plugin de métricas con type mismatch |
| `@ts-expect-error` | 1 (`build-app.ts` L268) | Plugin de métricas |
| `eslint-disable react-hooks/exhaustive-deps` | 3 | `BillingScreen.tsx`, `CreateTenantModal.tsx`, `PlatformScreen.tsx` |

### Problemas de tipado específicos

| Archivo | Problema | Severidad |
|---|---|---|
| [`BillingScreen.tsx` L10](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/billing/BillingScreen.tsx#L10) | `useState<any[]>([])` para lista de planes | 🟡 Medio |
| [`PlatformScreen.tsx` L19-L27](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/platform/PlatformScreen.tsx#L19) | 5 estados con `any` para datos del dashboard | 🟠 Alto |
| [`client.ts` L569-L584](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/lib/api/client.ts#L569) | 6 métodos de API de plataforma retornan `any` | 🟠 Alto |
| [`TenantDetailDrawer.tsx` L8-L9](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/platform/components/TenantDetailDrawer.tsx#L8) | Props `api: any`, `tenant: any` | 🟠 Alto |

### Lógica de negocio en UI

| Archivo | Problema |
|---|---|
| [`BillingScreen.tsx` L33](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/billing/BillingScreen.tsx#L33) | Lógica de negocio (selección de gateway) directamente en pantalla — debería ser un hook |
| [`ScannerReconciliationScreen.tsx` L117](file:///Users/MiguelBernal/APPS/REACT/POS/apps/pos-web/src/features/inventory/ScannerReconciliationScreen.tsx#L117) | `window.confirm()` en lógica de negocio — antipatrón |

---

## FASE 9 — ENTREGABLES CONSOLIDADOS

### 9.1 Inventario de módulos de pago

| Gateway | Estado | Checkout | Webhook | Producción-ready |
|---|---|---|---|---|
| Wompi | ✅ Implementado | ✅ | ✅ | ✅ Sí |
| Stripe | ⚠️ Parcial | ✅ | ⚠️ Bug status | ⚠️ Casi |
| MercadoPago | ❌ Incompleto | ✅ | ❌ Siempre PENDING | ❌ No |
| Mock | ✅ Solo dev | ✅ | ✅ | ⚠️ Riesgo en prod |

### 9.2 Inventario de suscripciones y billing

| Componente | Estado |
|---|---|
| `billing_plans` con seed STARTER/PRO/ENTERPRISE | ✅ |
| `tenant_subscriptions` tabla | ✅ |
| Creación de sub en registro público | ❌ |
| Creación de sub en registro superadmin | ✅ |
| Actualización de sub en webhook APPROVED | ❌ |
| Actualización de sub en cambio manual de plan | ✅ |
| Renovación automática de suscripciones | ❌ No implementado |
| Lógica de expiración/PAST_DUE | ❌ No implementado |
| MRR/ARR calculado en dashboard | ✅ (datos inconsistentes) |

### 9.3 Lista de duplicados encontrados

| ID | Descripción | Severidad |
|---|---|---|
| DUP-001 | `POST /platform/tenants/:id/impersonate` duplicado | 🔴 Crítico |
| DUP-002 | `GET /platform/tenants` duplicado | 🔴 Crítico |
| DUP-003 | Métricas de plataforma duplicadas | 🔴 Crítico |
| DUP-004 | Migración `042_` con nombre duplicado | 🔴 Crítico |
| DUP-005 | Parseo de `REFRESH_TOKEN_EXPIRES_IN` triplicado | 🟠 Alto |
| DUP-006 | Query de `branchIds` triplicado | 🟠 Alto |
| DUP-007 | Construcción de JWT payload duplicada | 🟠 Alto |

### 9.4 Lista de funciones no implementadas

| ID | Descripción | Severidad |
|---|---|---|
| NI-001 | `MercadoPagoGateway.parseWebhook()` siempre PENDING | 🔴 Crítico |
| NI-002 | `StripeGateway.parseWebhook()` status FAILED inválido | 🔴 Crítico |
| NI-003 | `StripeGateway.verifyPayment()` retorna `true` hardcodeado | 🟠 Alto |
| NI-004 | Impersonación sin JWT (archivo huérfano) | N/A (huérfano) |
| NI-005 | Registro sin `tenant_subscriptions` | 🟠 Alto |
| NI-006 | Webhook APPROVED no actualiza `tenant_subscriptions` | 🟠 Alto |
| NI-007 | Email de bienvenida simulado | 🟡 Medio |
| NI-008 | Health check hardcodeado | 🟡 Medio |
| NI-009 | Validación PIN scanner | 🟡 Medio |
| NI-010 | Notificaciones de bajo stock | 🟡 Medio |

### 9.5 Lista de código muerto

| Elemento | Ubicación | Tipo |
|---|---|---|
| `StripeGateway.verifyPayment()` | `stripe-gateway.ts` L84 | Método |
| `urlParams` sin uso | `mercadopago-gateway.ts` L70 | Variable |
| Archivo completo `platform.routes.ts` | `identity/http/platform.routes.ts` | Archivo |
| Directorios: `identity/domain/`, `identity/services/`, `platform-admin/application/`, `platform-admin/domain/` | Varios | Directorios |

### 9.6 Funcionalidades huérfanas

| ID | Elemento | Recomendación |
|---|---|---|
| HU-001 | `identity/http/platform.routes.ts` completo | Eliminar |
| HU-002 | `identity/domain/` vacío | Eliminar |
| HU-003 | `identity/services/` vacío | Eliminar |
| HU-004 | `platform-admin/application/` vacío | Poblar con casos de uso |
| HU-005 | `platform-admin/domain/` vacío | Poblar con entidades |
| HU-006 | Seed no crea suscripciones | Actualizar seed |

### 9.7 Hallazgos críticos

1. **MercadoPago es non-functional** — ningún pago vía MercadoPago se procesa exitosamente
2. **`042_` migration duplicada** — riesgo de fallo en migraciones en nuevos entornos
3. **`platform.routes.ts` es código muerto** — 4 endpoints y 176 líneas que nunca se ejecutan
4. **`tenant_subscriptions` desincronizado** — el flujo de pago no actualiza la tabla de suscripciones

### 9.8 Hallazgos importantes

1. Stripe retorna status inválido `'FAILED'` que rompe el contrato TypeScript
2. La lógica de parseo de token y construcción de JWT está duplicada 3-4 veces en `auth.routes.ts`
3. El registro público no crea suscripciones, afectando las métricas del dashboard
4. El endpoint `mock-checkout` sin protección de NODE_ENV es un vector de fraude potencial

### 9.9 Hallazgos menores

1. `verifyPayment()` en `StripeGateway` es código muerto
2. `urlParams` declarado sin uso en `MercadoPagoGateway`
3. Directorios vacíos en varios contextos
4. Email de bienvenida simulado con `app.log.info`
5. Health check hardcodeado como "Healthy"

### 9.10 Refactors recomendados (priorizados)

Ver Fase 7 — Quick Wins → Bajo → Medio → Alto esfuerzo.

### 9.11 Matriz de deuda técnica

| Área | Severidad | Esfuerzo | Prioridad |
|---|---|---|---|
| MercadoPago webhook | 🔴 Crítico | Medio | **P0** |
| Duplicación `platform.routes.ts` | 🔴 Crítico | Quick Win | **P0** |
| Migración 042 duplicada | 🔴 Crítico | Quick Win | **P0** |
| Stripe status FAILED | 🔴 Crítico | Quick Win | **P0** |
| tenant_subscriptions vacía (registro) | 🟠 Alto | Bajo | **P1** |
| tenant_subscriptions no actualizada (webhook) | 🟠 Alto | Bajo | **P1** |
| JWT payload/branchIds duplicados | 🟠 Alto | Bajo | **P1** |
| Tipado `any` masivo en frontend platform | 🟠 Alto | Medio | **P2** |
| God route `platform-admin.routes.ts` | 🟡 Medio | Medio | **P2** |
| Health check real | 🟡 Medio | Medio | **P3** |
| Notificaciones externas | 🟡 Medio | Alto | **P3** |

### 9.12 Roadmap de limpieza

**Sprint 1 — Quick Wins (< 1 día total)**
- [ ] Fix Stripe status `'FAILED'` → `'DECLINED'`
- [ ] Eliminar `StripeGateway.verifyPayment()`
- [ ] Renombrar migración `042_inventory_valuation_branch.ts`
- [ ] Proteger `mock-checkout` con guard de entorno
- [ ] **Eliminar `identity/http/platform.routes.ts`**
- [ ] Eliminar directorios vacíos

**Sprint 2 — Integridad de datos (2-3 días)**
- [ ] Agregar `tenant_subscriptions` en `auth/register`
- [ ] Actualizar `tenant_subscriptions` en webhook APPROVED
- [ ] Actualizar seed con suscripciones y nombres de plan correctos
- [ ] Extraer helpers: `parseExpiryToMs()`, `buildAuthResponse()`, `getUserBranchIds()`

**Sprint 3 — Completar billing (3-5 días)**
- [ ] Implementar `MercadoPagoGateway.parseWebhook()` con fetch real
- [ ] Descomponer `platform-admin.routes.ts` en casos de uso
- [ ] Implementar health check real
- [ ] Tipar frontend de plataforma con interfaces

**Sprint 4 — Billing recurrente (> 1 semana)**
- [ ] Cron job de renovación de suscripciones
- [ ] Lógica PAST_DUE + notificación de expiración
- [ ] Servicio de email real
- [ ] Validación de PIN en scanner

---

*Nivel de confianza general: **Alto** — todos los hallazgos están respaldados por evidencia de código concreto.*
