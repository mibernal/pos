# Technical Debt Report

Fecha de analisis: 2026-05-09
Actualizacion aplicada: 2026-05-16

## Resumen

La deuda principal esta en acoplamiento de flujo critico, duplicacion entre API/worker/frontend y algunos contratos que no reflejan completamente el modelo real. El sistema tiene buena base de tests y migraciones, asi que el refactor puede ser incremental. No conviene reestructurar el monorepo completo.

## Metricas de Complejidad

- Fuente analizada: 177 archivos TS/TSX, aprox. 21080 LOC.
- Tests detectados: 34 archivos.
- Archivos > 500 LOC: 5 de fuente productiva y 3 tests grandes.
- Dependencias mas centrales por imports:
  - `@pos-dian/shared`: 18 imports productivos.
  - `react`: 31 imports.
  - `fastify`: 27 imports.
  - `kysely`: 23 imports.
  - `zod`: 17 imports.
  - `bullmq`: 10 imports.

## Deuda Critica

### P0 - Nota credito DIAN no esta modelada de forma segura (corregido 2026-05-16)

Archivos:

- `apps/api/src/routes/sales.ts`
- `apps/worker/src/jobs/outbox-sale-voided.processor.ts`
- `apps/worker/src/domain/dian-document-status.ts`
- `apps/api/src/infra/db/migrations/001_initial_schema.ts`

Problema original:

- La DB tiene `uq_dian_documents_tenant_sale`, una sola fila DIAN por venta.
- La anulacion usa la misma fila del documento original para `CREDIT_NOTE`.
- No existe `document_type`, ni referencia a documento original, ni CUDE separado de nota credito.
- `outbox-sale-voided.processor.ts` exige documento original `ACCEPTED`, pero luego llama `planDianStatusTransition(ACCEPTED, providerStatus)`.
- La maquina de estados no permite transiciones desde `ACCEPTED`; con provider mock que devuelve `ACCEPTED`, la nota credito falla.

Impacto:

- Anular una venta aceptada puede dejar outbox `FAILED` reintentando.
- La documentacion dice que se crea nota credito paralela, pero el modelo no lo soporta.
- Riesgo fiscal alto.

Estado actual:

- Migracion `009_dian_document_types` agrega `document_type`, `parent_document_id` y unicidad por `tenant_id + sale_id + document_type`.
- `SALE_CREATED` opera sobre `INVOICE`.
- `SALE_VOIDED` crea/reutiliza `CREDIT_NOTE` y aplica transiciones desde `PENDING`.
- Se agregaron tests del processor de anulacion.

### P0 - `SENT` no tiene mecanismo de finalizacion

Archivo:

- `apps/worker/src/jobs/outbox-sale-created.processor.ts`
- `apps/worker/src/domain/dian-document-status.ts`

Problema:

- Si el provider devuelve `SENT`, el worker marca outbox como `SENT`.
- Luego `getDianEmissionBlockReason` bloquea reemision cuando el documento esta `SENT`.
- No hay polling de estado, webhook ni job de confirmacion.

Impacto:

- Documentos pueden quedar indefinidamente en `SENT`.
- El cajero ve un estado intermedio sin cierre fiscal.

### P1 - `routes/sales.ts` concentra demasiadas responsabilidades

Archivo:

- `apps/api/src/routes/sales.ts` con aprox. 877 LOC.

Responsabilidades mezcladas:

- Validacion request/response.
- Idempotencia `client_uuid`.
- Lock de caja.
- Scope de productos.
- Calculo fiscal.
- Normalizacion de pagos.
- Consecutivo.
- Persistencia de venta/items.
- Mutacion de inventario.
- Creacion documento DIAN.
- Outbox.
- Auditoria.
- Listado/detalle/anulacion.

Impacto:

- Cualquier cambio de venta tiene blast radius alto.
- Dificulta testear unidades de negocio sin fixture grande.
- Aumenta riesgo de regresion en caja/fiscal/inventario.

### P1 - Duplicacion fuerte en worker DIAN

Archivos:

- `apps/worker/src/jobs/outbox-sale-created.processor.ts`
- `apps/worker/src/jobs/outbox-sale-voided.processor.ts`

Problema:

- Normalizadores de pago, tax lines, items, payload, claim/mark outbox estan duplicados.
- Ambos usan SQL raw similar pero divergente.
- Ya existe test dedicado para `outbox-sale-voided.processor.ts`, pero la duplicacion de normalizadores, payload y SQL sigue pendiente.

Impacto:

- Arreglar payload DIAN en facturas no garantiza arreglo en notas credito.
- Drift silencioso entre invoice y credit note.

### P1 - Contratos compartidos con drift (parcialmente corregido)

Archivos:

- `packages/shared/src/schemas/sale.ts`
- `packages/shared/src/types/domain.ts`
- `apps/api/src/domain/sales-service.ts`

Problema:

- `schemas/sale.ts` incluye `customer_id`, `tax_lines_json`, `payment_json` actualizado.
- `types/domain.ts` fue alineado para `customer_id` y se agrego tipo de documento DIAN.
- `apps/api/src/domain/sales-service.ts` parece servicio in-memory antiguo: mantiene `salesInMemory`, usa `dianQueue`, permite `tax_category` del cliente y no coincide con la ruta real.

Impacto:

- Nuevos cambios pueden importar tipos incorrectos.
- Riesgo de usar accidentalmente servicio muerto en tests o features nuevas.

## Deuda Alta

### P1 - API mantiene dependencia BullMQ/Redis aparentemente innecesaria

Archivos:

- `apps/api/src/app/build-app.ts`
- `apps/api/src/infra/queue/dian-queue.ts`
- `apps/api/src/types.d.ts`

Problema:

- `buildApp` decora `app.dianQueue`, pero la ruta de ventas actual usa outbox en DB y no llama `app.dianQueue`.
- Esto conserva acoplamiento runtime API -> Redis aunque la emision deberia depender del worker.

Impacto:

- API puede heredar fallos o configuracion de Redis sin necesidad funcional.
- Confunde la arquitectura: queue directa vs outbox.

### P1 - Backend acepta precio desde cliente

Archivo:

- `apps/api/src/routes/sales.ts`
- `packages/shared/src/schemas/sale.ts`

Problema:

- `saleItemInputSchema` permite `price_cents`.
- La API usa `item.price_cents ?? product.price_cents`.
- Tax category se protege usando DB, pero precio no.

Impacto:

- Un cliente manipulado puede alterar precios.
- Offline con precios stale puede registrar ventas con precio anterior. Esto puede ser intencional, pero debe ser una decision explicita y auditada.

### P1 - Tenant isolation incompleta en inventario (mitigado en API)

Archivos:

- `apps/api/src/routes/inventory.ts`
- `apps/api/src/infra/db/migrations/008_customers_and_inventory.ts`

Problema:

- `inventoryRoutes.post` valida producto por tenant, pero no valida explicitamente que `branch_id` pertenezca al tenant.
- FKs de `inventory_balances` e `inventory_transactions` referencian `branches(id)` y `products(id)`, no pares compuestos `(tenant_id, id)`.

Impacto:

- Riesgo teorico de escribir saldos con `tenant_id` y `branch_id` inconsistentes si se pasa un UUID valido de otra sucursal.

Estado actual:

- `GET /inventory/balances` y `POST /inventory/transactions` validan explicitamente que la sucursal pertenezca al tenant autenticado.
- Sigue pendiente endurecer FKs compuestas en migracion separada.

### P1 - Provider HTTP normaliza respuestas desconocidas a `ACCEPTED` (corregido)

Archivo:

- `apps/worker/src/providers/dian-provider-http-generic.ts`

Problema original:

- `normalizeProviderStatus` devolvia `ACCEPTED` cuando `status` no era string o no coincidia.
- `extractCude` permitia `ACCEPTED` con `cude = null`.

Estado actual:

- El provider HTTP ahora rechaza respuestas sin `status` valido.
- `ACCEPTED` exige CUDE/UUID fiscal.

Impacto:

- Un provider mal configurado ahora falla y entra en retry, en lugar de marcar aceptacion falsa.

## Deuda Media

### P2 - Offline documentado como mas fuerte de lo implementado

Archivos:

- `README.md`
- `docs/ARCHITECTURE.md`
- `apps/pos-web/src/features/sales/PosScreen.tsx`
- `apps/pos-web/src/lib/offline-queue.ts`
- `apps/pos-web/vite.config.ts`

Problema:

- PWA cachea assets y la cola guarda ventas, pero el catalogo se mantiene en memoria.
- Recargar offline no conserva productos.

Impacto:

- Expectativa operativa puede no cumplirse en tienda sin red.

### P2 - Auth multi-tenant depende de email global en la practica

Archivo:

- `apps/api/src/routes/auth.ts`
- `apps/api/src/infra/db/migrations/001_initial_schema.ts`

Problema:

- DB permite mismo email en tenants distintos.
- Login busca `users.email = email` globalmente y falla si hay mas de un candidato.

Impacto:

- Multi-tenant real con usuarios repetidos requiere selector de tenant, dominio o restriccion global documentada.

### P2 - JWT y contexto POS viven en localStorage

Archivos:

- `apps/pos-web/src/lib/session/storage.ts`

Problema:

- Token bearer persiste en localStorage.
- Es comun en SPAs, pero aumenta impacto de XSS.

Impacto:

- Riesgo de secuestro de sesion si aparece XSS.

### P2 - Reportes agrupan pagos en JS

Archivo:

- `apps/api/src/routes/reports.ts`

Problema:

- Para desglose por medio de pago, carga `payment_json` de todas las ventas filtradas y agrupa en memoria.

Impacto:

- Puede degradar con volumen alto por sucursal/periodo.

### P2 - Inventario permite stock negativo

Archivos:

- `apps/api/src/routes/sales.ts`
- `apps/api/src/routes/inventory.ts`

Problema:

- La venta descuenta inventario sin verificar disponibilidad.
- Ajuste manual puede generar saldos negativos si se registra salida mayor al saldo.

Impacto:

- Puede ser aceptable para POS flexible, pero debe decidirse y auditarse.

### P2 - Fechas de reportes/historial usan conversion local a ISO

Archivos:

- `apps/pos-web/src/features/history/HistoryScreen.tsx`
- `apps/pos-web/src/features/reports/ReportsScreen.tsx`

Problema:

- La UI arma rangos de fechas con `new Date(...).toISOString()`.
- En Colombia puede desplazar limites contra dias locales si el servidor/DB se interpreta distinto.

Impacto:

- Reportes diarios pueden incluir/excluir ventas cercanas a medianoche.

## Deuda Baja y Limpieza

### P3 - Build artifacts locales presentes pero ignorados

Directorios:

- `apps/api/dist`
- `apps/worker/dist`
- `apps/pos-web/dist`
- `packages/shared/dist`

Estan ignorados por `.gitignore` y no aparecen tracked, pero pueden contaminar busquedas locales.

### P3 - Documentacion con drift (parcialmente corregido)

Archivos:

- `README.md`
- `docs/ARCHITECTURE.md`
- `IMPLEMENTATION_PLAN.md`

Ejemplos:

- `IMPLEMENTATION_PLAN.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md` y `docs/DECISIONS.md` fueron actualizados al modelo `INVOICE`/`CREDIT_NOTE`.
- La advertencia offline queda documentada como assets + cola local, no catalogo persistente tras recarga.

### P3 - Estilo UI y responsabilidades mezcladas

Archivos:

- `PosScreen.tsx`
- `HistoryScreen.tsx`
- `ProductsScreen.tsx`
- `InventoryScreen.tsx`
- `CustomersScreen.tsx`

Problema:

- Mucho estilo inline, estado y side effects en los componentes de pantalla.

Impacto:

- No bloquea funcionalidad, pero encarece evolucion.

## Dependencias Implicitas

- `sales.client_uuid` debe conservarse igual en cada reintento offline.
- `payment_json` debe mantener shape `{ mode, total_cents, amounts, payments }`.
- `tax_lines_json` debe ser array JSONB con `line_index`, `category`, `base_cents`, `tax_cents`, `rate`.
- `products.tax_category` es fuente fiscal, no `items.tax_category`.
- `tenant.tax_mode` decide IVA vs INC.
- `outbox_events.type` solo se procesa si es `SALE_CREATED` o `SALE_VOIDED`.
- Worker asume que puede reconstruir payload completo desde DB aunque `payload_json` sea minimo.
- `dian_documents.status` controla idempotencia fiscal.
- `dian_documents.document_type` separa idempotencia de factura y nota credito.
- `dian_documents.cude` bloquea reemision por documento fiscal.
- UI asume que `dian_status` puede venir en lista de ventas, pero detalle usa `dian_document`.
- Login asume email no duplicado entre tenants activos.
- `X-Branch-Id` se usa para scope de productos.

## Quick Wins

1. Extraer servicios internos de `routes/sales.ts`.
2. Marcar `apps/api/src/domain/sales-service.ts` como legacy o eliminarlo con justificacion cuando haya test verde.
3. Dejar de decorar `app.dianQueue` si no hay ruta que lo use, o documentar su proposito.
4. Centralizar normalizadores de worker antes de cambiar comportamiento.
5. Migrar FKs de inventario a constraints compuestas por tenant cuando sea posible.
6. Documentar si `price_cents` desde cliente es override permitido o si debe ignorarse.
7. Implementar finalizacion de documentos DIAN en `SENT`.
8. Persistir catalogo offline en IndexedDB si se requiere operar tras reload sin red.

## Gaps de Tests

- Falta test de inventario cross-tenant/branch.
- Falta test de venta con `price_cents` manipulado vs precio DB, segun decision esperada.
- Falta test de `SENT` como estado intermedio DIAN.
- Falta test de reportes con volumen/pagos mixtos mas amplio.
- Falta test de offline reload sin catalogo persistente si se decide soportarlo.
