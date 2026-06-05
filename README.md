# POS DIAN - Colombia (Multi-Tenant)

Un Punto de Venta (POS) multi-tenant de alto rendimiento con emisión de facturación electrónica (DIAN) en Colombia. Diseñado con una arquitectura desacoplada asíncrona, capacidades Offline-First PWA, observabilidad distribuida y empaquetamiento listo para la Nube.

> **Estado actual (Junio 2026):** Sistema operativo en desarrollo activo. Observabilidad distribuida implementada. UX de alta velocidad para cajero implementada. Catálogo offline-resiliente con Dexie + fallback en memoria activo.

---

## 🏗 Arquitectura (Monorepo Turborepo)

Este proyecto está construido como un monorepo administrado con `pnpm` workspace y `turborepo`. Sus módulos son:

| Módulo | Descripción |
|---|---|
| `apps/api` | Backend principal en **Fastify + Kysely + TypeScript + Zod**. Maneja la lógica core, seguridad (JWT + RLS), trazas OTLP y expone la API RESTful. |
| `apps/worker` | Servidor de Background Jobs en **BullMQ**. Extrae eventos desde la base de datos (patrón *Transactional Outbox*) para emisión a la DIAN, con reintentos y backoff exponencial. |
| `apps/pos-web` | Frontend PWA en **React + Vite**. Interfaz de caja con catálogo precargado en IndexedDB (Dexie), cola local de ventas pendientes, atajos de teclado y soporte táctil. |
| `packages/shared` | Tipos, esquemas Zod y contratos compartidos en todo el monorepo. |

---

## 🚀 Capacidades

### Core Operativo
- **Multi-Tenant & Roles Granulares:** Cada negocio opera aislado lógicamente (PostgreSQL RLS). Roles: `ADMIN`, `MANAGER`, `CASHIER`, `AUDITOR`.
- **Control de Efectivo Avanzado:** Apertura/cierre de caja, arqueos intermedios (ciegos para cajeros), cierres Z y reportes por turno.
- **Inventario Enterprise:** Catálogo con variantes, promociones avanzadas (`PERCENTAGE`, `FIXED_AMOUNT`, `BUY_X_GET_Y`) y alertas de stock mínimo.

### Emisión Fiscal
- **Emisión Asíncrona Robusta:** La venta se persiste atómicamente (PostgreSQL) junto al evento Outbox. El Worker reintenta contra el provider DIAN sin bloquear al cajero.
- **Anulaciones y Notas Crédito:** Soporte completo `SALE_VOIDED` → `CREDIT_NOTE` vinculada vía `parent_document_id`. El inventario se repone atómicamente.
- **Idempotencia Comercial:** `client_uuid` garantiza que reintentos de red nunca dupliquen ventas.

### Offline-First PWA
- **Catálogo Persistente:** Dexie.js cachea hasta 5.000 SKUs en IndexedDB con TTL de 12 horas por `branch_id`. Al expirar o fallar la red, carga desde caché sin interrumpir al cajero.
- **Cola de Ventas Offline:** Las ventas pendientes sobreviven cierres del navegador en IndexedDB con reintentos automáticos al reconectar (`navigator.onLine`).
- **Almacenamiento Persistente:** Solicita `navigator.storage.persist()` al iniciar para prevenir evicción del SO en tablets con poco espacio.
- **Service Worker (Workbox):** Assets cacheados para funcionamiento sin red.

### UX de Alta Velocidad
- **Atajos de Teclado Globales (Checkout):**
  - `F1` → Efectivo · `F2` → Tarjeta · `F3` → Transferencia · `F4` → Pago Mixto
  - `Enter` → Confirmar cobro (cuando el formulario es válido)
  - `Ctrl+K` → Foco en búsqueda de producto
- **Multiplicador de Escáner:** Sintaxis `CANTIDAD*CÓDIGO` (ej. `5*7701234567890`) desde teclado o escáner físico para agregar múltiples unidades en un paso.
- **Botones Rápidos de Billetes:** `Exacto`, `$20.000`, `$50.000`, `$100.000` en el panel de efectivo con auto-foco en el campo de monto.
- **Responsive Táctil:** Tap targets ≥ 40px. Layout app-like en tablets (768px) con `grid-template-rows: 1fr auto` — sin scroll de página.

### Hardware
- **Impresión de Tickets:** HTML dinámico (58mm / 80mm) y ESC/POS directo por Web Serial API (`navigator.serial`) sin diálogos del sistema.
- **Báscula Serial:** Integración con básculas por Web Serial API (baudRate 9600, compatible Mettler/CAS). Botón por ítem en el carrito.

### Observabilidad Distribuida
- **OpenTelemetry SDK** instrumentado en `apps/api` (trazas HTTP, DB y métricas de negocio).
- **Stack completo:** OpenTelemetry Collector → Prometheus → Grafana + Tempo (trazas) + Loki (logs).
- **Métricas de negocio custom:** `pos.sales.count`, etc. exportadas vía OTLP.

---

## 💻 Quickstart (Ambiente Local)

### 1. Requisitos
- Node.js `20.x`
- pnpm `10.x` (`npm install -g pnpm@latest`)
- Docker Desktop

### 2. Variables de Entorno
```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/pos-web/.env.example apps/pos-web/.env
```

### 3. Infraestructura Core (PostgreSQL + Redis)
```bash
cd infra && docker compose up -d && cd ..
```

### 4. Infraestructura de Observabilidad (Opcional)
```bash
cd infra && docker compose -f docker-compose.obs.yml up -d && cd ..
```

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

| Rol | Email | Contraseña |
|---|---|---|
| `ADMIN` | `admin@demo.posdian.local` | `Admin123*` |
| `CASHIER` | `cashier@demo.posdian.local` | `Cashier123*` |

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

El proyecto incluye Dockerfiles multi-etapa optimizados usando `pnpm deploy`:

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
