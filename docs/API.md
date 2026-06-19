# POS DIAN API - Documentación Técnica Final

Esta documentación refleja el **estado actual real** de las APIs del Backend del sistema POS multi-tenant. Está orientada al equipo de ingeniería para integraciones, desarrollo frontend y mantenimiento.

## Índice General

1. [Arquitectura de Seguridad](#1-arquitectura-de-seguridad)
2. [Módulo: Autenticación y Sesión](#2-módulo-autenticación-y-sesión)
3. [Módulo: Identidad (Usuarios y Sucursales)](#3-módulo-identidad-usuarios-y-sucursales)
4. [Módulo: Identidad & Branches](#4-módulo-identidad--branches)
5. [Módulo: Ventas (Sales)](#5-módulo-ventas)
6. [Módulo: Mesas (Tables)](#6-módulo-mesas)
7. [Módulo: Cajas (Cash Sessions)](#7-módulo-cajas)
8. [Módulo: Inventario y Carga Masiva](#8-módulo-inventario-y-carga-masiva)
9. [Módulo: SaaS Billing & Webhooks](#9-módulo-saas-billing--webhooks)
10. [Módulo: Dashboard y Reportes](#10-módulo-dashboard-y-reportes)
11. [Módulo: Auditoría y Alertas](#11-módulo-auditoría-y-alertas)
12. [Módulo: Platform (SuperAdmin)](#12-módulo-platform-superadmin)

---

## 1. Arquitectura de Seguridad

### Autenticación y Tokens
El sistema utiliza **Autenticación Bearer (JWT)**.
* **Token de Acceso (Access Token):** Expira en corto tiempo (ej: 15 min). Se envía en la cabecera `Authorization: Bearer <token>`.
* **Token de Refresco (Refresh Token):** Almacenado como una cookie HTTP-Only (`refresh_token`). Permite obtener un nuevo Access Token.

### Aislamiento Multi-Tenant
La separación lógica de datos ocurre a través de `tenant_id`.
* El `tenant_id` **no se envía en el body ni en la URL**. Se extrae automáticamente de forma segura desde el JWT validado en cada request (`request.auth.tenantId`).
* Es imposible hacer "Tenant Hopping" (saltar entre bases de datos de clientes) si el JWT está intacto.

### Jerarquía y Rol-Base Access Control (RBAC)
Cada endpoint (ruta) es validado por el plugin `requirePermissions`. Los roles están rígidamente atados a un subconjunto de permisos.

| Rol | Alcance sobre Sucursales (Scope) | Permisos Destacados |
| :--- | :--- | :--- |
| **ADMIN** | **Global** (Todas las sucursales del Tenant) | `settings:manage`, `users:manage`, `dashboard:global:view`, Todos los demás permisos. |
| **MANAGER** | **Restringido** (Solo sucursales asignadas en `user_branches`) | `users:manage` (solo cajeros), `inventory:adjust`, `reports:view`. |
| **CASHIER** | **Restringido** (Solo sucursales asignadas) | `sales:create`, `cash:open`, `cash:close`, `inventory:view`. |
| **AUDITOR** | **Global** (Visualización de todas las sucursales) | `audit:view`, `alerts:view`, `reports:view`. No puede mutar datos. |

---

## 2. Módulo: Autenticación y Sesión

### `POST /api/v1/auth/login`
Inicia sesión en el sistema.
* **Permisos Requeridos:** `Ninguno` (Público)
* **Request Schema:**
  ```json
  {
    "email": "admin@example.com",
    "password": "password123"
  }
  ```
* **Response:**
  Devuelve el objeto del usuario, el JWT en JSON y establece una cookie `refresh_token`.
* **Errores:** `401 Unauthorized` (Credenciales inválidas).

### `POST /api/v1/auth/refresh`
Renueva el Access Token usando la cookie HTTP-Only.
* **Permisos Requeridos:** `Ninguno` (La cookie es validada).
* **Response:** Nuevo JWT (`{ "accessToken": "..." }`).
* **Errores:** `401 Unauthorized` (Token expirado o inválido).

### `POST /api/v1/auth/logout`
Destruye la sesión eliminando el Refresh Token.
* **Permisos Requeridos:** Requiere JWT válido.

### `GET /api/v1/auth/me`
Devuelve el perfil del usuario actual, su tenant, rol y sucursales asignadas.
* **Permisos Requeridos:** Requiere JWT válido.

---

## 3. Módulo: Identity & Users

### `GET /api/v1/admin/users`
Lista los usuarios del Tenant.
* **Permisos Requeridos:** `users:manage`
* **Scope:** Un MANAGER solo ve a los CASHIERS asignados a las sucursales del MANAGER.
* **Response:** Lista de usuarios (id, tenantId, email, name, role, active, createdAt).

### `POST /api/v1/admin/users`
Crea un nuevo usuario en el Tenant.
* **Permisos Requeridos:** `users:manage`
* **Restricción Crítica:** Un MANAGER solo puede crear perfiles con rol `CASHIER` y solo puede asignar sucursales a las que él mismo tiene acceso.
* **Request Schema:**
  ```json
  {
    "email": "cajero@example.com",
    "password": "strongPassword",
    "name": "Juan Perez",
    "role": "CASHIER",
    "active": true,
    "branch_ids": ["uuid-sucursal-1"]
  }
  ```

### `PATCH /api/v1/admin/users/:id/branches`
Modifica las sucursales asignadas a un usuario.
* **Permisos Requeridos:** `users:manage`
* **Restricción Crítica:** Un MANAGER solo puede modificar las sucursales de un `CASHIER`.

---

## 4. Módulo: Identity & Branches

### `GET /api/v1/branches`
Lista las sucursales.
* **Permisos Requeridos:** `branches:view`
* **Scope:** Si el rol no es ADMIN, la respuesta solo devuelve las sucursales asignadas al usuario.

### `POST /api/v1/branches`
Crea una nueva sucursal (locación física o lógica).
* **Permisos Requeridos:** `branches:manage`
* **Request Schema:** `{ "name": "Norte", "code": "NRTE-01", "address": "...", "phone": "...", "active": true }`

---

## 5. Módulo: Ventas

### `POST /api/v1/sales`
Registra una nueva venta / orden.
* **Cabecera Obligatoria:** `Idempotency-Key: <uuid>` (Evita cargos duplicados si hay reintentos de red).
* **Permisos Requeridos:** `sales:create`
* **Scope:** Valida que el `branch_id` enviado pertenezca al usuario en sesión. Valida que exista una Sesión de Caja abierta y activa.
* **Request Schema (Contrato Crítico):**
  ```json
  {
    "branch_id": "uuid",
    "terminal_id": "uuid",
    "cash_session_id": "uuid",
    "customer_id": "uuid",
    "items": [
      {
        "product_id": "uuid",
        "quantity": 2,
        "unit_price_cents": 15000,
        "tax_rate": 0.19,
        "subtotal_cents": 30000,
        "tax_cents": 5700,
        "total_cents": 35700
      }
    ],
    "payments": [
      {
        "method": "CASH",
        "amount_cents": 35700,
        "reference": null
      }
    ],
    "subtotal_cents": 30000,
    "tax_cents": 5700,
    "discount_cents": 0,
    "total_cents": 35700
  }
  ```
* **Notas de Negocio:** Este endpoint inyecta automáticamente el evento `SaleCompleted` a la tabla `outbox` para la integración asíncrona con el Facturador Electrónico DIAN.

### `GET /api/v1/sales`
Lista el historial de ventas.
* **Permisos Requeridos:** `sales:view`
* **Scope:** Filtra ventas por el `branch_id` permitido del usuario.

### `POST /api/v1/sales/void`
Anula (void) una venta existente.
* **Permisos Requeridos:** `sales:void`
* **Notas de Negocio:** Inserta evento de anulación en `outbox` si ya había sido facturado. Devuelve los items al inventario si aplica.

---

## 6. Módulo: Mesas (Tables)

### `GET /api/pos/v1/tables`
Lista los salones y mesas de una sucursal específica.
* **Permisos Requeridos:** `sales:create`
* **Query Params:** `branch_id`

### `GET /api/pos/v1/tables/:tableId/order`
Obtiene el pedido actual activo de una mesa.
* **Permisos Requeridos:** `sales:create`

### `POST /api/pos/v1/tables/:tableId/order`
Guarda/Sincroniza un pedido en curso a una mesa. Si se guardan items, la mesa cambia a estado `OCCUPIED`.
* **Permisos Requeridos:** `sales:create`
* **Request Schema:**
  ```json
  {
    "branch_id": "uuid",
    "subtotal_cents": 30000,
    "discount_cents": 0,
    "total_cents": 35700,
    "items": [
      {
        "product_id": "uuid",
        "variant_id": null,
        "qty": 2,
        "price_cents": 15000,
        "line_total_cents": 30000
      }
    ]
  }
  ```

### `DELETE /api/pos/v1/tables/:tableId/order`
Limpia el pedido actual de la mesa (cambiándola a `AVAILABLE`). Usado tras cobrar exitosamente.
* **Permisos Requeridos:** `sales:create`
* **Query Params:** `branch_id`

---

## 7. Módulo: Cajas

### `POST /api/v1/cash-sessions`
Apertura una caja.
* **Permisos Requeridos:** `cash:open`
* **Scope:** Se debe tener acceso al `branch_id`. Falla si la terminal ya tiene una caja abierta.
* **Request:** `{ "branch_id": "uuid", "terminal_id": "uuid", "opening_amount_cents": 50000 }`

### `POST /api/v1/cash-sessions/:id/close`
Cierra la sesión de caja actualizando la conciliación (arqueo).
* **Permisos Requeridos:** `cash:close`
* **Seguridad:** Si el rol es `CASHIER`, el backend valida explícitamente que la sesión fue abierta por el *mismo* usuario que intenta cerrarla.
* **Request:** `{ "closing_cash_real_cents": 150000, "notes": "Cierre del día" }`
* **Response:** Calcula `expected_cash_cents` (Ventas + Base de apertura - Retiros) y `diff_cents` (Sobrante/Faltante).

---

## 8. Módulo: Inventario y Carga Masiva

### `GET /api/v1/products`
Catálogo de productos.
* **Permisos Requeridos:** `products:view`

### `POST /api/v1/inventory/bulk-import`
Sube un archivo (CSV/Excel) para importar miles de productos en *background*.
* **Content-Type:** `multipart/form-data`
* **Permisos Requeridos:** `inventory:manage`
* **Response:** `{ "jobId": "uuid", "status": "QUEUED" }`

### `GET /api/v1/inventory/balances`
Obtiene el saldo disponible de productos por sucursal.
* **Permisos Requeridos:** `inventory:view`

### `POST /api/v1/inventory/adjust`
Ajuste de inventario (Suma o Resta por merma/daño). Implementa **Optimistic Locking**.
* **Cabecera Obligatoria:** `Idempotency-Key: <uuid>`
* **Permisos Requeridos:** `inventory:adjust`
* **Request:** `{ "branch_id": "uuid", "product_id": "uuid", "qty_change": -2, "reason": "DAMAGE", "expectedVersion": 1 }`

### `POST /api/v1/inventory/transfer`
Movimiento de inventario entre dos sucursales.
* **Cabecera Obligatoria:** `Idempotency-Key: <uuid>`
* **Permisos Requeridos:** `inventory:transfer`

### `POST /api/v1/scanner/resolve`
Endpoint optimizado para buscar productos mediante código de barras en POS.
* **Permisos Requeridos:** `sales:create`
* **Request:** `{ "barcode": "770123456789", "branch_id": "uuid" }`

---

## 9. Módulo: SaaS Billing & Webhooks

### `GET /api/v1/billing/checkout/:gateway`
Genera un enlace o sesión de pago para realizar el cobro del servicio SaaS al Tenant.
* **Permisos Requeridos:** `PlatformOwner`, `TenantOwner`, o `ADMIN`.
* **Gateway soportados:** `wompi`, `mercadopago`

### `POST /api/v1/webhooks/:gateway`
Webhook público asíncrono para recibir actualizaciones de las transacciones (aprobadas/rechazadas) y hacer *upgrade* del plan.
* **Permisos Requeridos:** Ninguno (Valida firma de encriptación del Gateway).

---

## 10. Módulo: Dashboard y Reportes

### `GET /api/v1/dashboard/global`
Dashboard financiero para dueños/socios.
* **Permisos Requeridos:** `dashboard:global:view` (Exclusivo para ADMIN).
* **Scope:** No filtra por sucursal. Agrega ingresos, márgenes y métricas de todo el tenant de forma cruzada.

### `GET /api/v1/dashboard/stream` (Server-Sent Events)
Stream en tiempo real (SSE) de métricas de la sucursal activa.
* **Permisos Requeridos:** `dashboard:view` (Requiere `branch_id` en Query).
* **Notas de Negocio:** Permite que las pantallas en el restaurante o tienda se actualicen en tiempo real usando subscripción a PostgreSQL listen/notify o polling. Requiere envío de cabeceras CORS de forma manual debido a limitaciones técnicas del SSE en Fastify.

---

## 11. Módulo: Auditoría y Alertas

### `GET /api/v1/audit`
Registro de acciones inmutables del sistema.
* **Permisos Requeridos:** `audit:view`
* **Notas de Negocio:** Registra cada `INSERT`, `UPDATE`, `DELETE` en tablas críticas (usualmente capturado por Triggers SQL en PostgreSQL), o vía `auditContextStorage`.

### `GET /api/v1/alerts`
Bandeja de alertas del sistema (Bajo Stock, Cierre con Descuadre, Error DIAN).
* **Permisos Requeridos:** `alerts:view`
* **Scope:** Restringe las alertas a las sucursales donde el usuario tiene acceso.

---

## 12. Módulo: Platform (SuperAdmin)

### `GET /api/v1/platform/tenants`
Lista todos los tenants del sistema con sus estados, planes de suscripción y métricas de uso.
* **Permisos Requeridos:** `PlatformOwner` o `PlatformAdmin`

### `POST /api/v1/platform/tenants/:id/suspend` / `reactivate`
Suspende o reactiva un tenant, bloqueando el acceso a todos sus usuarios si está suspendido.
* **Permisos Requeridos:** `PlatformOwner` o `PlatformAdmin`

### `PATCH /api/v1/platform/tenants/:id/plan`
Cambia el plan de suscripción de un tenant desde el Backoffice Global.
* **Permisos Requeridos:** `PlatformOwner` o `PlatformAdmin`

### `GET / POST / PATCH / DELETE /api/v1/platform/tenants/:id/users`
CRUD completo sobre los usuarios de un tenant específico. Permite al SuperAdmin crear nuevos usuarios, editar los existentes o resetear accesos dentro de la cuenta de un cliente.
* **Permisos Requeridos:** `PlatformOwner` o `PlatformAdmin`

---

## Eventos Asíncronos (Outbox Pattern)
La integración con facturación DIAN y otros servicios se realiza mediante inserciones a la tabla `outbox`.

**Lista de Eventos Críticos:**
1. `SALE_CREATED`: Creado cuando `/api/v1/sales` responde `201`. Payload: Venta con uuid de cliente.
2. `SALE_VOIDED`: Creado cuando `/api/v1/sales/void` responde `200`. Emite Nota Crédito.
3. `SALE_RETURNED`: Devoluciones parciales que afectan factura electrónica.

## Recomendaciones para Mantener Documentación
* Dado que el proyecto utiliza `@fastify/swagger` y `zod`, se recomienda **generar OpenAPI Specification V3** en formato JSON habilitando `/docs/json` e importando el archivo en herramientas como Postman, Stoplight o Swagger UI local.
* Cuando se agreguen nuevos permisos en `permissions.ts`, actualizar de inmediato esta documentación en las secciones respectivas.
