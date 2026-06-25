# POS DIAN - Colombia (SaaS Multi-Tenant)

Un Sistema de Punto de Venta (POS) y Gestión Hospitalaria (Hospitality & Retail) multi-tenant de alto rendimiento con emisión de facturación electrónica (DIAN) en Colombia. Diseñado con una arquitectura modular habilitable (Feature Flags), asíncrona, capacidades Offline-First PWA, observabilidad distribuida y preparado para la nube.

> **Estado actual (Junio 2026):** Sistema Enterprise activo. Feature Flags Jerárquicos (Macro + Micro) implementados y configurables desde el SuperAdmin. Sistema de medición SaaS (billing metrics) en producción via snapshots en `subscription_events`. Backup automático diario de PostgreSQL en GCS con validación semanal de integridad. Dashboard Live consolidado en Reportes (pestaña ⚡ En Vivo). Arquitectura de Módulos migrada a tenant flags directos. Sincronización Offline resiliente en cajas operativas.

---

## 🏗 Arquitectura (Monorepo Turborepo)

Este proyecto está construido como un monorepo administrado con `pnpm` workspace y `turborepo`. Sus módulos son:

| Módulo | Descripción |
|---|---|
| `apps/api` | Backend principal en **Fastify + Kysely + TypeScript + Zod**. Maneja la lógica core, seguridad (JWT + RLS), trazas OTLP y WebSockets (Socket.io). |
| `apps/worker` | Servidor de Background Jobs en **BullMQ**. Extrae eventos desde la base de datos (patrón *Transactional Outbox*) para emisión DIAN y cargas masivas. |
| `apps/pos-web` | Frontend PWA en **React + Vite**. Renderizado condicional inteligente (ModuleGuard), offline-first y soporte táctil avanzado. |
| `packages/shared` | Tipos, esquemas Zod y contratos compartidos en todo el monorepo. |

---

## 🚀 Ecosistema de Módulos (Feature Flags)

El SaaS escala dinámicamente mediante 14 Feature Flags granulares, ajustando la UI y conexiones (ej: Lazy Sockets) sin cargar recursos innecesarios.

- **Flujo Retail:** Operación ultrarrápida para minimarkets y farmacias. Multiplicador por escáner (`5*770...`), atajos de teclado globales y báscula serial.
- **Flujo Restaurante (Restaurant Core):** Ruteo inteligente por salones y mesas, transferencias, asignación de meseros (`waiter_id`), cantidad de comensales, división de cuentas (`split_bill`) y gestión de propinas (`tips`).
- **Flujo Kitchen Display System (KDS):** Back of House (BOH). Visualización asíncrona de tickets con WebSockets, cálculo de deltas ("Fire to Kitchen") y actualización de estados (`PENDING`, `PREPARING`, `DONE`).
- **Flujo Delivery:** Ciclo de vida propio para domicilios (Pendiente -> Preparación -> En Camino -> Entregado) con facturación diferida.

---

## 🌍 Arquitectura Multi-Tenant & SaaS Core

- **Seguridad RLS:** Aislamiento lógico de base de datos inyectando `app.current_tenant_id` en Kysely, bloqueando cruces de información a nivel nativo.
- **Roles:** Gestión cruzada (`PLATFORM_OWNER`, `PLATFORM_ADMIN`) y roles granulares de negocio (`ADMIN`, `MANAGER`, `CASHIER`, `AUDITOR`).
- **SuperAdmin Dashboard:** Gestión transversal con queries analíticas pesadas (ARR, MRR) cacheadas en **Redis** con patrones de invalidación (SCAN+DEL).
- **Billing:** Motor `RenewalEngine` en background (BullMQ) integrado con Webhooks para cobros recurrentes de planes SaaS.

---

## ⚡ Rendimiento Cloud y UX de Alta Velocidad

### Optimizaciones Base de Datos e IPC
- **WebSockets Reactivos:** Las mesas y tickets de cocina se sincronizan instantáneamente evitando el estrangulamiento de Base de Datos causado por HTTP Polling.
- **Partial Indexes:** Índices parciales en PostgreSQL (`status = 'OPEN'`) para escanear en microsegundos sólo las transacciones vivas.
- **Emisión Asíncrona Robusta:** La venta se persiste atómicamente con el evento Outbox. El Worker reintenta contra la DIAN sin bloquear al cajero.
- **Idempotencia:** `client_uuid` protege contra ventas duplicadas por redes intermitentes.

### UX Cajero (Offline-First)
- **Catálogo Persistente:** Dexie.js cachea hasta 5.000 SKUs localmente (TTL de 12 horas).
- **Cola Offline:** Sobrevive cierres de app en IndexedDB y se reintenta automáticamente (`navigator.onLine`).
- **Billetes Rápidos:** Botones dinámicos ($20.000, $50.000) y navegación táctil de categoría grande (CategoryGrid).

### UX de Alta Velocidad
- **Atajos de Teclado Globales (Checkout):**
  - `F1` → Efectivo · `F2` → Tarjeta · `F3` → Transferencia · `F4` → Pago Mixto
  - `Enter` → Confirmar cobro (cuando el formulario es válido)
  - `Ctrl+K` → Foco en búsqueda de producto
- **Multiplicador de Escáner:** Sintaxis `CANTIDAD*CÓDIGO` (ej. `5*7701234567890`) desde teclado o escáner físico para agregar múltiples unidades en un paso.
- **Navegación Visual Táctil:** Selector de categorías dinámico (CategoryGrid) con grandes tarjetas jerárquicas optimizadas para tablets (Bebidas, Entradas, Platos Fuertes, etc.) que desaparecen automáticamente al hacer búsquedas directas.
- **Botones Rápidos de Billetes:** `Exacto`, `$20.000`, `$50.000`, `$100.000` en el panel de efectivo con auto-foco en el campo de monto.
- **Responsive Táctil:** Tap targets ≥ 40px. Layout app-like en tablets (768px) con `grid-template-rows: 1fr auto` — sin scroll de página.

### Hardware
- **Impresión de Tickets:** HTML dinámico (58mm / 80mm) y ESC/POS directo por Web Serial API (`navigator.serial`) sin diálogos del sistema.
- **Báscula Serial:** Integración con básculas por Web Serial API (baudRate 9600, compatible Mettler/CAS). Botón por ítem en el carrito.

### Observabilidad Distribuida
- **OpenTelemetry SDK** instrumentado nativamente en `apps/api`.
- **Trazas de Negocio Semánticas:** Contexto profundo inyectado en flujos críticos (Ventas, Webhooks de Pagos, Renovaciones y Cargas Masivas de Inventario) usando `TracerHelper.withSpan()`. Propagación de trazas W3C habilitada en workers **BullMQ**.
- **Stack completo (Local & Nube):** OpenTelemetry Collector → Prometheus → Grafana + Tempo (trazas) + Loki (logs).
- **Métricas de negocio custom:** `pos.sales.count`, latencias y contadores DIAN exportadas vía OTLP.

---

## 💻 Quickstart (Ambiente Local)

### 1. Requisitos
- Node.js `20.x` o superior
- pnpm `10.x` (Fijado globalmente vía `packageManager` en el `package.json`. Se instalará automáticamente si usas `corepack enable`).
- Docker Desktop

### 2. Variables de Entorno
```bash
cp .env.example .env
cp apps/pos-web/.env.example apps/pos-web/.env
```

### 3. Infraestructura Core & Observabilidad (PostgreSQL, Redis, Grafana, Loki, etc.)
Para evitar advertencias de contenedores huérfanos (orphan containers), recomendamos levantar toda la infraestructura del proyecto `pos-dian` mediante un comando unificado:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.obs.yml up -d
```

> **Nota:** Si solo deseas levantar la base de datos y caché sin observabilidad, puedes omitir el segundo archivo:
> `docker compose -f infra/docker-compose.yml up -d`

### 5. Dependencias
```bash
pnpm install
```

### 6. Base de Datos
```bash
pnpm --filter @pos-dian/api db:migrate
pnpm --filter @pos-dian/api db:seed
```

### 7. Ejecutar en Modo Desarrollo
```bash
pnpm dev
```

---

## 🌍 URLs Locales

| Servicio | URL |
|---|---|
| POS Web | http://localhost:5173 |
| API REST | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| Grafana | http://localhost:3100 *(si levantaste obs.)* |
| Prometheus | http://localhost:9090 *(si levantaste obs.)* |

---

## 🔑 Credenciales Demo

El script de inicialización (`pnpm db:seed`) crea un entorno multi-tenant para pruebas. La contraseña por defecto para todas las cuentas es **`Password123*`**.

### Plataforma Global (Backoffice SaaS)
| Rol | Email |
|---|---|
| `PLATFORM_OWNER` | `superadmin@demo.posdian.local` |
| `PLATFORM_OWNER` (Admin) | `platform_admin@demo.posdian.local` |

### Tenant 1: Restaurante Multi-Sede (Plan Pro)
| Rol | Email |
|---|---|
| `ADMIN` | `admin@demo.posdian.local` |
| `MANAGER`| `manager@demo.posdian.local` |
| `CASHIER`| `cashier@demo.posdian.local` |

### Tenant 2: Retail Básico (Plan Básico)
| Rol | Email |
|---|---|
| `ADMIN` | `admin2@demo.posdian.local` |
| `CASHIER`| `cashier2@demo.posdian.local` |

### Tenant 3: Pizzería Napoli (Plan Pro)
| Rol | Email |
|---|---|
| `ADMIN` | `admin3@demo.posdian.local` |
| `MANAGER`| `manager3@demo.posdian.local` |
| `CASHIER`| `cashier3@demo.posdian.local` |

### Tenant 4: Tokyo Sushi (Plan Pro)
| Rol | Email |
|---|---|
| `ADMIN` | `admin4@demo.posdian.local` |
| `MANAGER`| `manager4@demo.posdian.local` |
| `CASHIER`| `cashier4@demo.posdian.local` |

---

## ⚙️ Flujo de Demo

1. Entra como `ADMIN` → **Configuración del Negocio** (NIT, dirección, ticket 58mm/80mm).
2. **Configuración DIAN** → elige modo fiscal (`IVA` o `INC_RESTAURANT`).
3. **Productos** → asigna `tax_category` a cada SKU.
4. Abre caja en la sucursal demo.
5. En la pantalla POS: busca con `Ctrl+K`, agrega con `↑↓ + Enter`, cobra con `F1` + `Enter`.
6. Revisa el **Historial** → estado DIAN, CUDE, ticket, anulaciones.
7. Desconecta el cable de red → vende → reconecta → observa sincronización automática.

---

## 🧾 Modelo Fiscal

- `dian_documents.document_type` distingue `INVOICE` y `CREDIT_NOTE`.
- Las facturas se crean con la venta desde el outbox `SALE_CREATED`.
- Las notas crédito se crean desde `SALE_VOIDED` con `parent_document_id` apuntando a la factura original.
- El provider HTTP exige `status` válido (`SENT`, `ACCEPTED`, `REJECTED`) y `CUDE` cuando responde `ACCEPTED`.
- `GET /api/v1/sales/:id` expone `dian_document` como la factura principal por retrocompatibilidad.

---

## 🚢 Despliegue en Producción

El proyecto incluye Dockerfiles multi-etapa listos para Producción. 

> **Aviso pnpm v10+**: Los Dockerfiles utilizan `pnpm deploy` bajo la arquitectura moderna de v10+. Para garantizar que los microservicios se empaqueten de manera aislada e inmutable, el proyecto requiere de la directiva global `inject-workspace-packages=true` definida en `.npmrc`. Si actualizas el archivo `.npmrc` en un futuro, recuerda correr `pnpm install` para que tu lockfile refleje siempre el esquema de workspaces inyectados antes de intentar compilar imágenes de Docker.

### API
```bash
docker build -t pos-dian-api -f apps/api/Dockerfile .
```
Variables requeridas: `DATABASE_URL`, `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `OTLP_TRACE_ENDPOINT` (opcional)

### Worker (BullMQ)
```bash
docker build -t pos-dian-worker -f apps/worker/Dockerfile .
```
Variables requeridas: `DATABASE_URL`, `REDIS_URL`, `DIAN_PROVIDER`, `DIAN_HTTP_URL`

> El worker expone `/health` en `$PORT` (default `8080`) para cumplir con SLA de plataformas PaaS (Render, Railway, DigitalOcean App Platform).

### Frontend Estático
```bash
VITE_API_URL=https://tu-api.com/api/v1 pnpm --filter @pos-dian/pos-web build
```
Desplegable en Vercel, Netlify o S3 + CloudFront.

### CI/CD
La integración continua está parametrizada en `.github/workflows/ci.yml` y ejecuta `pnpm build`, `pnpm lint` y `pnpm test` en todos los Pull Requests hacia `main`.

---

## ⚠️ Pendientes para Producción

- Provider DIAN real (PAC) certificado end-to-end.
- Consulta/webhook de finalización para documentos que queden en estado `SENT`.
- Despliegue con HTTPS, gestión de secretos, backups automáticos y operación multi-instancia.
- Políticas operativas de soporte, rotación de usuarios y recuperación de incidentes.
