import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * El contrato tiene que decir también qué devuelve cada ruta.
 *
 * Hoy no lo dice en casi ninguna: de 193 operaciones, 31 declaran esquema de respuesta y
 * 162 no. Eso tiene tres consecuencias, y ninguna es cosmética.
 *
 * La primera es que `/docs` miente por omisión: documenta lo que cada ruta recibe y calla
 * lo que devuelve, así que quien integre contra esta API tiene que adivinar leyendo código
 * ajeno.
 *
 * La segunda es que los tipos del frontend no pueden salir del contrato —que es justo lo
 * que pide el criterio de salida de la fase 11— porque el contrato no los tiene. Mientras
 * este hueco exista, «añadir un endpoint no requiere escribir tipos a mano» solo es cierto
 * para los endpoints cuyo esquema ya vive en `@pos-dian/shared`.
 *
 * La tercera es de seguridad y es la que de verdad incomoda. Fastify serializa la respuesta
 * a través del esquema declarado y recorta lo que no esté en él. Sin esquema no recorta
 * nada: si un handler selecciona de más —un `select *` sobre `users`, un join que arrastra
 * `password_hash` o `pin_hash`—, eso sale por el cable y ninguna prueba se entera.
 *
 * Esta prueba no arregla nada. Hace algo más modesto y más útil: pone el hueco por escrito
 * y no lo deja crecer. Una ruta nueva sin esquema de respuesta rompe aquí y hay que
 * declararla o añadirla a la lista a conciencia. Y cuando una de las que están en la lista
 * gana su esquema, la prueba también falla, para obligar a tacharla: una lista de deuda que
 * no se vacía sola deja de contarse y se vuelve decorado.
 */

interface OperacionOpenApi {
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

function operacionesSinEsquemaDeRespuesta(): string[] {
  const spec = JSON.parse(
    readFileSync(resolve(__dirname, '../../../../openapi.json'), 'utf8')
  ) as { paths: Record<string, Record<string, OperacionOpenApi>> };

  const sin: string[] = [];
  for (const [ruta, operaciones] of Object.entries(spec.paths)) {
    for (const [metodo, operacion] of Object.entries(operaciones)) {
      const exito = operacion.responses?.['200'] ?? operacion.responses?.['201'];
      if (!exito?.content?.['application/json']?.schema) {
        sin.push(`${metodo.toUpperCase()} ${ruta}`);
      }
    }
  }
  return sin.sort();
}

/**
 * Las que todavía no lo declaran. Cada línea que desaparezca de aquí es una ruta que
 * pasó a decir qué devuelve, y con ella los tipos que el frontend deja de escribir a mano.
 */
const SIN_ESQUEMA_DE_RESPUESTA = [
  "DELETE /api/v1/billing/payment-methods/{id}",
  "DELETE /api/v1/branches/{branchId}/tables/{tableId}/order",
  "DELETE /api/v1/payment-methods/{code}",
  "DELETE /api/v1/platform/plans/{id}",
  "DELETE /api/v1/platform/tenants/{id}/users/{userId}",
  "DELETE /api/v1/products/{id}/images/{imageId}",
  "DELETE /api/v1/promotions/{id}",
  "DELETE /api/v1/recipes/{recipeId}",
  "GET /api/v1/admin/audit-logs",
  "GET /api/v1/admin/audit-logs/{correlation_id}",
  "GET /api/v1/admin/tenants/current",
  "GET /api/v1/admin/users",
  "GET /api/v1/alerts",
  "GET /api/v1/alerts/stream",
  "GET /api/v1/auth/me",
  "GET /api/v1/billing/gateway-config",
  "GET /api/v1/billing/invoices/{id}",
  "GET /api/v1/billing/mock-checkout",
  "GET /api/v1/billing/payment-methods",
  "GET /api/v1/billing/plans",
  "GET /api/v1/billing/portal",
  "GET /api/v1/branches",
  "GET /api/v1/card-batches/preview",
  "GET /api/v1/cash-sessions/current",
  "GET /api/v1/cash-sessions/{id}/tips",
  "GET /api/v1/cash-sessions/{id}/z-report",
  "GET /api/v1/customers",
  "GET /api/v1/customers/{id}/statement",
  "GET /api/v1/dashboard/global",
  "GET /api/v1/dashboard/global/stream",
  "GET /api/v1/dashboard/stream",
  "GET /api/v1/dashboard/tech-health",
  "GET /api/v1/health",
  "GET /api/v1/inventory/balances",
  "GET /api/v1/inventory/enterprise-bulk/{jobId}",
  "GET /api/v1/kds/stream",
  "GET /api/v1/payment-methods",
  "GET /api/v1/platform/activity",
  "GET /api/v1/platform/alerts/stream",
  "GET /api/v1/platform/billing/metrics",
  "GET /api/v1/platform/coupons",
  "GET /api/v1/platform/dashboard",
  "GET /api/v1/platform/growth",
  "GET /api/v1/platform/health",
  "GET /api/v1/platform/plans",
  "GET /api/v1/platform/plans/{id}/entitlements",
  "GET /api/v1/platform/revenue",
  "GET /api/v1/platform/tenants",
  "GET /api/v1/platform/tenants/{id}/usage",
  "GET /api/v1/platform/tenants/{id}/users",
  "GET /api/v1/products/images/{imageId}",
  "GET /api/v1/products/{id}/images",
  "GET /api/v1/promotions",
  "GET /api/v1/public/catalog/{branchId}",
  "GET /api/v1/public/qr/{token}",
  "GET /api/v1/receivables",
  "GET /api/v1/recipes",
  "GET /api/v1/recipes/reports/consumption-deviation",
  "GET /api/v1/recipes/{productId}",
  "GET /api/v1/reports/kardex",
  "GET /api/v1/reports/operations/menu-engineering",
  "GET /api/v1/reports/operations/prep-time",
  "GET /api/v1/reports/operations/sales-by-hour",
  "GET /api/v1/reports/operations/table-turnover",
  "GET /api/v1/reports/sales",
  "GET /api/v1/reports/shifts",
  "GET /api/v1/reports/waiters",
  "GET /api/v1/settings/tips",
  "GET /api/v1/terminals",
  "GET /api/v1/waiter-shifts",
  "GET /api/v1/waiter-shifts/{id}/summary",
  "GET /metrics",
  "PATCH /api/v1/admin/tenants/current",
  "PATCH /api/v1/admin/tenants/current/modules",
  "PATCH /api/v1/admin/tenants/{id}/tax-profile",
  "PATCH /api/v1/admin/users/{id}/branches",
  "PATCH /api/v1/admin/users/{id}/role",
  "PATCH /api/v1/admin/users/{id}/status",
  "PATCH /api/v1/alerts/{id}/resolve",
  "PATCH /api/v1/branches/{branchId}/delivery-persons/{id}",
  "PATCH /api/v1/branches/{id}",
  "PATCH /api/v1/customers/{id}",
  "PATCH /api/v1/platform/coupons/{code}",
  "PATCH /api/v1/platform/plans/{id}",
  "PATCH /api/v1/platform/tenants/{id}",
  "PATCH /api/v1/platform/tenants/{id}/modules",
  "PATCH /api/v1/platform/tenants/{id}/users/{userId}",
  "PATCH /api/v1/products/{id}",
  "PATCH /api/v1/products/{id}/images/{imageId}/primary",
  "PATCH /api/v1/promotions/{id}",
  "POST /api/v1/admin/users",
  "POST /api/v1/auth/impersonate/exchange",
  "POST /api/v1/auth/impersonate/stop",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/logout",
  "POST /api/v1/auth/refresh",
  "POST /api/v1/auth/register",
  "POST /api/v1/billing/checkout",
  "POST /api/v1/billing/coupons/redeem",
  "POST /api/v1/billing/pay-now",
  "POST /api/v1/billing/payment-methods",
  "POST /api/v1/branches",
  "POST /api/v1/card-batches",
  "POST /api/v1/cash-sessions/open",
  "POST /api/v1/cash-sessions/{id}/audit",
  "POST /api/v1/cash-sessions/{id}/close",
  "POST /api/v1/cash-sessions/{id}/movements",
  "POST /api/v1/cash-sessions/{id}/reconcile",
  "POST /api/v1/cash-sessions/{id}/tips/settle",
  "POST /api/v1/customers",
  "POST /api/v1/customers/{id}/payments",
  "POST /api/v1/inventory/adjustments",
  "POST /api/v1/inventory/bulk-import",
  "POST /api/v1/inventory/counts",
  "POST /api/v1/inventory/counts/{id}/commit",
  "POST /api/v1/inventory/counts/{id}/scan-batch",
  "POST /api/v1/inventory/enterprise-bulk/upload",
  "POST /api/v1/inventory/enterprise-bulk/{jobId}/confirm",
  "POST /api/v1/inventory/receipts/{id}/commit",
  "POST /api/v1/inventory/receipts/{id}/scan-batch",
  "POST /api/v1/inventory/transactions",
  "POST /api/v1/inventory/transfers",
  "POST /api/v1/inventory/transfers/{id}/receive",
  "POST /api/v1/inventory/transfers/{id}/reject",
  "POST /api/v1/inventory/transfers/{id}/ship",
  "POST /api/v1/journal/sync",
  "POST /api/v1/platform/billing/run-engine",
  "POST /api/v1/platform/coupons",
  "POST /api/v1/platform/plans",
  "POST /api/v1/platform/plans/{id}/yearly",
  "POST /api/v1/platform/tenants",
  "POST /api/v1/platform/tenants/{id}/impersonate",
  "POST /api/v1/platform/tenants/{id}/plan",
  "POST /api/v1/platform/tenants/{id}/plan/preview",
  "POST /api/v1/platform/tenants/{id}/reactivate",
  "POST /api/v1/platform/tenants/{id}/suspend",
  "POST /api/v1/platform/tenants/{id}/users",
  "POST /api/v1/products",
  "POST /api/v1/products/{id}/images",
  "POST /api/v1/products/{id}/toggle-active",
  "POST /api/v1/promotions",
  "POST /api/v1/public/qr/{token}/bill",
  "POST /api/v1/public/qr/{token}/orders",
  "POST /api/v1/sales/{id}/returns",
  "POST /api/v1/tables/{id}/qr-token",
  "POST /api/v1/terminals",
  "POST /api/v1/waiter-shifts/open",
  "POST /api/v1/waiter-shifts/{id}/close",
  "POST /api/v1/webhooks/payments/mercadopago",
  "POST /api/v1/webhooks/payments/stripe",
  "POST /api/v1/webhooks/payments/wompi",
  "PUT /api/v1/auth/profile/pin",
  "PUT /api/v1/customers/{id}/credit",
  "PUT /api/v1/payment-methods/{code}",
  "PUT /api/v1/platform/plans/{id}/entitlements",
  "PUT /api/v1/recipes/{productId}",
  "PUT /api/v1/settings/tips",
] as const;

describe('el contrato declara qué devuelve cada ruta', () => {
  it('ninguna ruta nueva se suma al hueco sin decirlo aquí', () => {
    const actual = operacionesSinEsquemaDeRespuesta();
    const conocidas = new Set<string>(SIN_ESQUEMA_DE_RESPUESTA);

    const nuevas = actual.filter((op) => !conocidas.has(op));
    expect(nuevas, `Rutas nuevas sin esquema de respuesta. Decláralo en la ruta, o añádelas a SIN_ESQUEMA_DE_RESPUESTA sabiendo lo que eso significa:
${nuevas.join('\n')}`).toEqual([]);
  });

  it('la lista de deuda se vacía sola: lo que ya tiene esquema no puede seguir apuntado', () => {
    const actual = new Set(operacionesSinEsquemaDeRespuesta());

    const yaResueltas = SIN_ESQUEMA_DE_RESPUESTA.filter((op) => !actual.has(op));
    expect(yaResueltas, `Estas rutas ya declaran su respuesta: bórralas de SIN_ESQUEMA_DE_RESPUESTA.
${yaResueltas.join('\n')}`).toEqual([]);
  });
});
