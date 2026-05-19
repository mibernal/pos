# DECISIONS

## D-001 Multi-tenant y multi-sucursal desde el inicio
- `tenant_id` es obligatorio en datos de negocio.
- `branch_id` se usa en flujo operativo de caja y ventas.
- Motivo: evitar re-arquitectura cuando el cliente pasa de una caja a varias sucursales.

## D-002 Caja modelada como sesión explícita
- La caja abre, opera y cierra sobre `cash_sessions`.
- Motivo: el arqueo, la restricción de caja abierta y la operación diaria quedan trazables.

## D-003 Emisión DIAN desacoplada por outbox + worker
- API registra venta y responde rápido.
- Worker toma `SALE_CREATED`, llama provider y actualiza estados.
- Motivo: el POS no debe depender en línea del proveedor fiscal.

## D-004 Idempotencia comercial con `client_uuid`
- Cada venta usa `client_uuid` enviado por `pos-web`.
- API devuelve la misma venta si ese `client_uuid` ya existe para el tenant.
- Motivo: evitar duplicados en reintentos y sincronización offline.

## D-005 Frontend POS modular con shell delgado
- `App.tsx` compone sesión, caja, navegación y modales.
- La lógica vive en `features/*`, `hooks/*` y `lib/*`.
- Motivo: permitir crecer a operación real sin concentrar todo en un solo componente.

## D-006 Precio final en POS; cálculo fiscal en backend
- El cajero trabaja con precio final y descuento.
- API resuelve `tax_mode`, `tax_category`, `tax_total_cents` y `tax_lines_json`.
- Motivo: mantener UX simple y evitar lógica fiscal en frontend.

## D-007 Consecutivo de venta por sucursal
- `sale_number` se asigna por `tenant_id + branch_id` dentro de transacción.
- La regla vive en `sale-numbering-service` y mantiene el constraint único como defensa final.
- Motivo: soportar concurrencia real sin lógica inline dispersa.

## D-008 Cola offline local y sincronización secuencial
- `pos-web` guarda ventas pendientes solo ante error de red.
- La cola reusa `POST /sales` y el mismo `client_uuid`.
- Motivo: robustez comercial simple, sin resolver conflictos avanzados todavía.

## D-009 Anulación de venta endurecida y solo para `ADMIN`
- La anulación exige motivo y persiste `void_reason`, `voided_by_user_id` y `voided_at`.
- El ticket y la UI reflejan `VOID`.
- Motivo: trazabilidad operativa y control de riesgo en caja.

## D-010 Perfil comercial mínimo centralizado en tenant
- `business_name`, `nit`, `address`, `phone` y `footer_message` viven en `tenants`.
- La sucursal complementa el ticket con nombre y dirección del punto de venta.
- Motivo: ticket y demo consistentes sin convertir el sistema en ERP.

## D-011 Maquina de estados DIAN centralizada en el worker
- Las transiciones validas viven en un helper dedicado.
- `ACCEPTED` y documentos con `CUDE` no se reemiten.
- Motivo: evitar transiciones invalidas y simplificar mantenimiento del flujo fiscal.

## D-012 Seguridad y observabilidad basicas por defecto
- Login con rate limit.
- CORS configurable por env.
- `request_id`, logs estructurados y `audit_logs`.
- Motivo: dejar una base razonable para ambientes reales sin introducir una plataforma enterprise.

## D-013 Documento fiscal por tipo
- `dian_documents.document_type` separa `INVOICE` y `CREDIT_NOTE`.
- Las notas credito usan `parent_document_id` para apuntar a la factura original.
- `GET /sales/:id` mantiene `dian_document` como factura principal para no romper clientes.
- Motivo: una nota credito debe tener estado y CUDE propios; reutilizar la factura aceptada produce transiciones invalidas.

## D-014 Provider HTTP estricto
- El provider HTTP no asume respuestas desconocidas como `ACCEPTED`.
- `ACCEPTED` requiere CUDE/UUID fiscal en la respuesta.
- Motivo: evitar falsos positivos fiscales ante proveedores mal configurados o payloads inesperados.
