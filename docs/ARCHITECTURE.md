# ARCHITECTURE

## Objetivo
`pos-dian` es un POS multi-tenant para Colombia, orientado a operación real de caja y cumplimiento DIAN sin meter la emisión fiscal dentro del request de venta.

## Componentes
- `apps/api`: Fastify + TypeScript + Kysely. Expone auth, sucursales, caja, productos, ventas, configuración comercial/fiscal y auditoría.
- `apps/worker`: BullMQ + PostgreSQL. Consume outbox, construye payload DIAN, aplica reglas de transición y persiste resultado del provider.
- `apps/pos-web`: React + Vite + PWA. Shell POS con login, apertura de caja, venta, historial, sincronización offline y configuración operativa.
- `packages/shared`: contratos Zod/TypeScript compartidos entre API, worker y web.

## Entidades clave
- `tenants`: tenant comercial. Guarda `tax_mode`, `business_name`, `nit`, `address`, `phone`, `footer_message`.
- `branches`: sucursal operativa. Aporta contexto de caja y datos de ticket por punto de venta.
- `users`: usuarios con rol `ADMIN` o `CASHIER`.
- `cash_sessions`: apertura y cierre de caja por sucursal.
- `products`: catálogo por tenant, con `tax_category` y alcance por sucursal o global.
- `sales` y `sale_items`: venta operativa, totales en `*_cents`, `client_uuid`, metadata de anulación.
- `dian_documents`: documentos fiscales por venta. Distingue `INVOICE` y `CREDIT_NOTE`, conserva CUDE por documento y enlaza notas crédito con `parent_document_id`.
- `outbox_events`: eventos de negocio para el worker.
- `audit_logs`: trazabilidad operativa de acciones críticas.

## Flujo POS completo
1. `pos-web` autentica con `POST /auth/login`.
2. `SessionProvider` persiste token y usuario básico, restaura sesión al recargar y la invalida limpiamente en `401`.
3. El usuario selecciona sucursal y abre caja con `POST /cash-sessions/open`.
4. La pantalla POS consume catálogo desde API, busca por nombre o código de barras y arma carrito local.
5. El checkout construye `CreateSaleInput` con `client_uuid`, `branch_id`, `cash_session_id`, `discount_cents`, `items` y `payments`.
6. API valida, calcula impuestos desde DB, asigna consecutivo por sucursal, guarda venta, items, `dian_documents.document_type = INVOICE` en `PENDING` y outbox `SALE_CREATED`.
7. POS muestra confirmación e imprime ticket. Si falla por red, la venta queda en cola offline local.
8. Historial lista ventas recientes por sucursal, permite reimpresión y, para `ADMIN`, anulación con motivo.

## Flujo fiscal Colombia
- Todos los montos se manejan en `*_cents`.
- El POS trabaja con precio final al consumidor; no calcula impuestos en frontend.
- `tenants.tax_mode` define el modo fiscal del negocio:
  - `IVA`
  - `INC_RESTAURANT`
- `products.tax_category` define la categoría por producto:
  - `IVA_19`
  - `IVA_5`
  - `IVA_0`
  - `EXEMPT`
  - `EXCLUDED`
  - `INC_8`
- En `POST /sales`, API usa siempre `tax_mode` del tenant y `tax_category` del producto persistido, no lo que llegue del frontend.
- El resultado se persiste en:
  - `subtotal_cents`
  - `discount_cents`
  - `tax_total_cents`
  - `tax_lines_json`
  - `total_cents`
- El ticket muestra texto contextual:
  - `Incluye IVA`
  - `Incluye INC`

## Flujo DIAN con worker
1. API inserta la venta y crea `outbox_events.type = SALE_CREATED`.
2. El scheduler del worker toma eventos pendientes y los convierte en jobs BullMQ.
3. `outbox-sale-created.processor` carga venta, items, tenant y sucursal.
4. El processor construye payload fiscal con:
  - `taxMode`
  - `taxTotalCents`
  - `taxLines`
  - items
  - pagos
  - datos del negocio y sucursal
5. El provider devuelve resultado DIAN.
6. El worker aplica reglas centralizadas de transición:
  - `PENDING -> SENT`
  - `SENT -> ACCEPTED`
  - `SENT -> REJECTED`
  - `PENDING -> REJECTED`
7. Transiciones inválidas se rechazan y documentos `ACCEPTED` no se reemiten.
8. Si el provider falla, el outbox pasa a retry con backoff.

## Anulación fiscal y nota crédito
1. `POST /sales/:id/void` es solo para `ADMIN`.
2. API cambia la venta a `VOID`, persiste motivo, usuario y fecha de anulación.
3. API repone inventario, audita `SALE_VOIDED` y crea outbox `SALE_VOIDED` si existe factura fiscal.
4. El worker busca la factura `INVOICE`; si no está `ACCEPTED`, marca el outbox como retry.
5. Cuando la factura está aceptada, el worker crea o reutiliza `dian_documents.document_type = CREDIT_NOTE`.
6. La nota crédito inicia su propia máquina de estados desde `PENDING`; la factura original no se reescribe.
7. La nota crédito guarda `parent_document_id` con el id de la factura original y usa `document_type = CREDIT_NOTE` en el payload al provider.
8. `GET /sales/:id` mantiene compatibilidad exponiendo `dian_document` como la factura principal.

## Flujo offline con `client_uuid`
1. Cada venta se crea en web con `client_uuid`.
2. Si `POST /sales` falla por red, `pos-web` guarda el payload completo en IndexedDB, con estado de sincronización, intentos y último error.
3. El shell muestra contador de ventas pendientes y botón `Sincronizar`.
4. La sincronización puede ser manual o automática al volver la conexión.
5. Se reusa el mismo `client_uuid` en cada reintento.
6. Si backend responde con la venta ya existente para ese `client_uuid`, la web la trata como sincronizada y elimina la pendiente.

## Roles y permisos
- `ADMIN` (Acceso global al Tenant):
  - configurar negocio y sucursales (`settings:manage`, `branches:manage`)
  - cambiar configuración de todos los usuarios (`users:manage`)
  - editar productos y catálogos (`products:manage`)
  - anular ventas (`sales:void`)
  - ver todas las ventas y dashboard global (`sales:view`, `dashboard:global:view`)
  - control de caja total (`cash:open`, `cash:close`, `cash:audit`)
- `MANAGER` (Acceso restringido a sus sucursales):
  - administrar únicamente cajeros (`users:manage` restringido)
  - reportes de sucursal (`reports:view`, `dashboard:view`)
  - movimientos de inventario (`inventory:adjust`, `inventory:receive`, `inventory:transfer`)
  - **No ve** dashboard global ni puede anular ventas.
- `CASHIER` (Acceso restringido a sus sucursales):
  - abrir/cerrar su propia caja (`cash:open`, `cash:close` validado por sesión)
  - vender (`sales:create`)
  - ver historial de ventas (`sales:view`)
  - ver saldos de inventario (`inventory:view`)
  - **No ve** acciones administrativas ni reportes.
- `AUDITOR` (Solo lectura global):
  - ver trazabilidad y sistema (`audit:view`, `alerts:view`)

## Observabilidad y seguridad operativa
- API agrega `request_id` y logs estructurados con `tenant_id`, `branch_id`, `user_id` y `sale_id` cuando aplica.
- Worker loguea por job `outbox_event_id`, `sale_id`, `tenant_id`, intento, transición DIAN y resultado del provider.
- `audit_logs` registra apertura/cierre de caja, creación/anulación de venta, cambios fiscales y cambios de productos.
- Login tiene rate limit básico y CORS configurable por entorno.

## Diagrama
```mermaid
flowchart LR
  A["POS Web"] --> B["POST /auth/login"]
  B --> C["Sesion persistida"]
  C --> D["Abrir caja"]
  D --> E["Carrito + checkout"]
  E --> F["POST /sales"]
  F --> G["Sales + sale_items"]
  F --> H["dian_documents INVOICE = PENDING"]
  F --> I["outbox SALE_CREATED"]
  I --> J["Worker"]
  J --> K["Provider DIAN"]
  K --> L["SENT / ACCEPTED / REJECTED"]
  F --> P["POST /sales/:id/void"]
  P --> Q["outbox SALE_VOIDED"]
  Q --> R["dian_documents CREDIT_NOTE"]
  R --> K
  E --> M["Falla de red"]
  M --> N["Cola offline con client_uuid"]
  N --> O["Sincronizar"]
  O --> F
```

## Lo que falta para producción final
- Provider DIAN real end-to-end certificado contra el contrato exacto del PAC.
- Mecanismo de consulta/finalización para documentos que queden en `SENT`.
- Observabilidad centralizada fuera de logs locales.
- Despliegue con secretos, HTTPS, backups y operación multi-instancia.
- Integraciones de hardware de impresión y, si aplica, medios de pago físicos.
