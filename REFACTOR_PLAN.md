# Refactor Plan

Fecha de analisis: 2026-05-09
Actualizacion aplicada: 2026-05-16

## Principios

- No reestructurar todo el proyecto de una vez.
- No cambiar APIs publicas sin documentarlo y sin tests de compatibilidad.
- Mantener endpoints, payloads y respuestas actuales mientras se extrae logica interna.
- Cada fase debe dejar el sistema funcional y deployable.
- Primero caracterizar comportamiento actual, despues refactorizar.
- Corregir riesgos fiscales con migraciones compatibles hacia atras.
- No introducir librerias nuevas salvo necesidad demostrada.

## Orden Recomendado

### Fase 0 - Baseline y caracterizacion (completada parcialmente)

Objetivo: saber exactamente que se rompe antes de tocar comportamiento.

Acciones:

1. Ejecutar `pnpm test` y `pnpm build` y guardar resultado.
2. Agregar tests de caracterizacion para:
   - `SALE_VOIDED` con documento original `ACCEPTED`. Completado.
   - provider `http` con status desconocido. Completado.
   - provider `http` con `ACCEPTED` sin CUDE. Completado.
   - estado DIAN `SENT`. Pendiente.
   - inventario con sucursal fuera de tenant. Pendiente.
   - venta con `price_cents` distinto a DB. Pendiente.
3. Actualizar documentacion existente con limitaciones reales.

Riesgo: bajo.

Compatibilidad: total.

### Fase 1 - Limpieza segura de contratos y codigo muerto

Objetivo: reducir confusion sin cambiar comportamiento.

Acciones:

1. Elegir `packages/shared/src/schemas/*` como fuente de verdad.
2. Marcar `packages/shared/src/types/domain.ts` como legacy o alinear sus interfaces con schemas.
3. Auditar imports de `apps/api/src/domain/sales-service.ts`.
4. Si no se usa, eliminarlo en PR separado con justificacion y tests verdes.
5. Revisar `app.dianQueue` en API:
   - si no se usa, remover decoracion y tipo;
   - si se quiere conservar, documentar por que existe.

Riesgo: bajo/medio.

Compatibilidad: no tocar endpoints ni DB.

### Fase 2 - Extraer servicio de creacion de venta

Objetivo: bajar el blast radius de `routes/sales.ts`.

Extracciones sugeridas:

| Nuevo modulo | Desde | Responsabilidad |
|---|---|---|
| `sales/sale-mapper.ts` | `routes/sales.ts` | `mapSaleRow`, columnas, DTO |
| `sales/load-existing-sale.ts` | `routes/sales.ts` | Idempotencia por `client_uuid` |
| `sales/create-sale-service.ts` | `routes/sales.ts` | Transaccion principal |
| `sales/sale-inventory-service.ts` | `routes/sales.ts` | Descuento de inventario por venta |
| `sales/sale-outbox-service.ts` | `routes/sales.ts` | Crear `dian_documents` y `outbox_events` |

Pasos:

1. Mover funciones puras primero.
2. Mantener tests existentes sin snapshot masivo.
3. Extraer transaccion sin cambiar SQL ni payload.
4. Mantener `POST /sales` como wrapper HTTP del servicio.
5. Solo despues ajustar reglas de precio o inventario.

Riesgo: medio por flujo de caja.

Compatibilidad: endpoint y respuesta sin cambios.

### Fase 3 - Extraer anulacion de venta e inventario inverso

Objetivo: aislar `VOID` y preparar nota credito real.

Extracciones:

- `sales/void-sale-service.ts`
- `sales/restore-inventory-for-void.ts`
- `sales/sale-audit-events.ts`

Pasos:

1. Mover anulacion actual sin cambiar comportamiento.
2. Agregar tests de inventario `SALE_VOID`.
3. Validar que `SALE_ALREADY_VOID` se mantiene igual.
4. Dejar el evento `SALE_VOIDED` igual por ahora.

Riesgo: medio.

Compatibilidad: endpoint y outbox sin cambios.

### Fase 4 - Consolidar worker DIAN

Objetivo: eliminar duplicacion antes de corregir modelo fiscal.

Extracciones:

| Nuevo modulo | Responsabilidad |
|---|---|
| `jobs/outbox-event-store.ts` | `claimOutboxEvent`, `markOutboxSent`, `markOutboxFailed` |
| `jobs/dian-payload-loader.ts` | SQL comun para venta, items, tenant, branch |
| `jobs/dian-payload-normalizers.ts` | Pagos, tax lines, tax category |
| `jobs/process-dian-emission.ts` | Plantilla comun de provider, metadata, retry |

Pasos:

1. Crear helpers con la misma logica duplicada.
2. Migrar `SALE_CREATED`.
3. Migrar `SALE_VOIDED`.
4. Agregar test equivalente para ambos processors.

Riesgo: medio/alto por fiscal.

Compatibilidad: no cambiar DB ni provider payload todavia.

### Fase 5 - Corregir modelo de documentos fiscales (completada en la base)

Objetivo: soportar factura y nota credito sin romper ventas existentes.

Plan aplicado:

1. Migracion aditiva `009_dian_document_types`:
   - `dian_documents.document_type` default `INVOICE`.
   - `dian_documents.parent_document_id` nullable.
   - constraint unico por `tenant_id + sale_id + document_type`.
2. Documentos existentes quedan como `INVOICE` por default.
3. Anulacion crea o busca documento `CREDIT_NOTE`.
4. `SALE_VOIDED` opera sobre `CREDIT_NOTE`, no sobre la factura.
5. Cada documento fiscal usa su propia maquina desde `PENDING`.
6. `/sales/:id` mantiene `dian_document` como factura para compatibilidad.

Riesgo: alto.

Compatibilidad:

- Migracion debe ser aditiva.
- No eliminar `dian_document` actual de respuesta.
- Cualquier nuevo campo debe ser opcional.

### Fase 6 - Endurecer reglas de negocio sensibles

Objetivo: cerrar agujeros sin romper operacion.

Decisiones necesarias:

1. Precio de venta:
   - Opcion conservadora: backend ignora `item.price_cents` salvo rol/config explicita.
   - Opcion compatible: aceptar override solo si coincide con DB o registrar auditoria de diferencia.
2. Inventario:
   - Decidir si stock negativo es permitido.
   - Si no, validar saldo con lock antes de venta/manual exit.
3. Tenant isolation:
   - Validar sucursal en `inventoryRoutes`.
   - Migrar FKs a compuestas cuando sea posible.
4. Auth multi-tenant:
   - Definir si email debe ser global o login debe incluir tenant.

Riesgo: medio/alto porque puede cambiar casos actualmente aceptados.

Compatibilidad:

- Primero loggear/auditar diferencias.
- Luego activar validacion estricta por feature flag o cambio documentado.

### Fase 7 - Offline/sync realista

Objetivo: hacer explicito el nivel offline y reducir sorpresas.

Opciones:

1. Documentar oficialmente: offline soporta ventas pendientes solo si catalogo ya esta cargado en memoria.
2. O implementar catalogo persistente:
   - IndexedDB store `product-cache`.
   - Versionado por tenant/sucursal.
   - Refresh al abrir caja.
   - Fallback read-only offline tras reload.

Pasos seguros:

1. Extraer `useProductCatalog`.
2. Agregar tests de cola offline.
3. Persistir catalogo sin cambiar checkout.
4. Mostrar timestamp de catalogo si se usa offline.

Riesgo: medio.

Compatibilidad: no cambia API.

### Fase 8 - Descomponer pantallas frontend

Objetivo: bajar complejidad UI sin cambiar UX.

Orden sugerido:

1. `PosScreen.tsx`
   - `useCart`
   - `useProductSearch`
   - `useCheckoutSale`
   - `ProductGrid`
   - `CartPanel`
2. `HistoryScreen.tsx`
   - `useSalesHistory`
   - `SalesList`
   - `SaleDetailPanel`
   - `VoidSaleModal`
3. `ProductsScreen.tsx`
   - `ProductForm`
   - `ProductList`
4. `ticket-printer.ts`
   - separar `buildTicketHtml` de `printSaleTicket`.

Riesgo: medio por UI, bajo si se mantiene DOM esperado en tests.

Compatibilidad: sin cambios API.

### Fase 9 - Reportes y operacion productiva

Objetivo: preparar volumen y soporte.

Acciones:

1. Mover agregaciones de `reports.ts` a SQL JSONB o vistas.
2. Indices por fecha/status si el volumen crece.
3. Metricas de outbox:
   - pendientes;
   - fallidos;
   - edad maxima;
   - intentos.
4. Runbook de recuperacion de DIAN/outbox.
5. Backups y rotacion de secretos.

Riesgo: bajo/medio.

## Riesgos por Fase

| Fase | Riesgo | Mitigacion |
|---|---:|---|
| 0 Baseline | Bajo | No cambia runtime |
| 1 Limpieza contratos | Bajo/Medio | PR pequeno, tests completos |
| 2 Crear venta service | Medio | Mantener endpoint y tests de venta |
| 3 Void service | Medio | Tests de inventario y auditoria |
| 4 Worker comun | Medio/Alto | Golden tests de payload |
| 5 Documentos fiscales | Ejecutada | Migracion aditiva, tests worker/API, compatibilidad de respuesta |
| 6 Reglas sensibles | Medio/Alto | Modo audit antes de reject |
| 7 Offline catalogo | Medio | Feature incremental sin tocar checkout |
| 8 UI split | Medio | Tests React existentes |
| 9 Reportes/ops | Bajo/Medio | Sin cambios funcionales visibles |

## APIs Publicas a Preservar

No cambiar sin versionar/documentar:

- `POST /api/v1/sales`
- `GET /api/v1/sales`
- `GET /api/v1/sales/:id`
- `POST /api/v1/sales/:id/void`
- Shape de `Sale`, `CreatedSaleResponse`, `SaleDetailResponse`.
- `payment_json`.
- `tax_lines_json`.
- `client_uuid` idempotente.
- `dian_status` en listado.
- `dian_document` nullable en detalle.
- Rutas de caja y productos usadas por POS.

## Quick Wins Recomendados Primero

1. Extraer servicios internos de `routes/sales.ts`.
2. Migrar normalizadores comunes del worker.
3. Definir politica de `price_cents` desde cliente.
4. Documentar precio override.
5. Quitar dependencia BullMQ de API si no se usa.
6. Implementar finalizacion de documentos en `SENT`.
7. Extraer `mapSaleRow` y columnas de `routes/sales.ts`.

## Metas de Complejidad

Metas pragmaticas, no dogmaticas:

- `routes/sales.ts`: de 861 LOC a menos de 250 LOC como capa HTTP.
- `PosScreen.tsx`: de 819 LOC a menos de 300 LOC como composicion.
- Worker processors: menos de 250 LOC cada uno, con helpers compartidos.
- Ningun archivo productivo nuevo mayor a 350 LOC sin justificacion.
- Tests nuevos para cada extraccion antes de cambios de comportamiento.

## Secuencia de PRs Sugerida

1. `docs/baseline-analysis` - documentos y tests de caracterizacion.
2. `refactor/shared-contracts-cleanup` - alinear tipos/dead code.
3. `refactor/sales-route-mappers` - extraer mappers sin comportamiento.
4. `refactor/create-sale-service` - extraer transaccion de venta.
5. `refactor/void-sale-service` - extraer anulacion.
6. `refactor/worker-common-payload` - consolidar worker.
7. `done/fix-dian-credit-note-model` - migracion aditiva y nota credito real.
8. `partial/hardening-inventory-tenant-scope` - validacion app hecha; constraints pendientes.
9. `hardening/offline-catalog-contract` - documentar o persistir catalogo.
10. `refactor/pos-screen-split` - descomponer frontend.
