# Plan de Implementación POS-DIAN — Estado Actual

**Fecha de actualización**: 16 de mayo de 2026
**Estado General**: ~96% completado
**Build**: ✅ Monorepo completo (`pnpm build`)
**Lint**: ✅ Monorepo completo (`pnpm lint`)
**Tests verificados**: API 59, Worker 23, Shared 12, POS Web 24 (118 total)

---

## 1. Lo completado hasta hoy

### ✅ API Fastify (100%)

Rutas implementadas y testeadas:

| Módulo | Ruta | Descripción |
|---|---|---|
| `auth.ts` | `/api/v1/auth/*` | Login, JWT, rate limiting |
| `branches.ts` | `/api/v1/branches` | Sucursales multi-tenant |
| `admin-tenants.ts` | `/api/v1/admin/tenants/*` | Perfil fiscal y comercial |
| `admin-users.ts` | `/api/v1/admin/users/*` | RBAC ADMIN/CASHIER |
| `health.ts` | `/api/v1/health` | Health check |
| `cash-sessions.ts` | `/api/v1/cash-sessions/*` | Apertura / cierre de caja |
| `products.ts` | `/api/v1/products/*` | Catálogo con imagen y categoría fiscal |
| `sales.ts` | `/api/v1/sales/*` | Creación, anulación, idempotencia |
| `customers.ts` | `/api/v1/customers/*` | Directorio clientes NIT/CC |
| `inventory.ts` | `/api/v1/inventory/*` | Balances y movimientos de stock |
| `reports.ts` ⭐ | `/api/v1/reports/sales` | Ingresos, transacciones, ticket promedio, por método de pago |

**Tests**: 59 tests API ✅

---

### ✅ Worker BullMQ (100%)

- `outbox-sale-created.processor.ts` — Emite factura electrónica DIAN
- `outbox-sale-voided.processor.ts` — Emite Nota Crédito `CREDIT_NOTE` separada cuando la factura `INVOICE` está `ACCEPTED`
- `outbox-events.scheduler.ts` — Polling periódico (outbox pattern)
- `dian-provider-http-generic.ts` — Integración HTTP real (URL + API Key + timeout), con validación estricta de `status` y CUDE en `ACCEPTED`
- `dian-provider-mock.ts` — Mock para staging/test
- Backoff exponencial configurable (`OUTBOX_RETRY_BASE_MS` / `OUTBOX_RETRY_MAX_MS`)
- Health server HTTP en puerto configurable
- Graceful shutdown SIGINT/SIGTERM
- **Lint y build**: ✅ 0 errores

---

### ✅ Base de Datos PostgreSQL (100%)

9 migraciones Kysely:

1. Schema inicial (tenants, users, branches, products, sales, dian_documents)
2. `client_uuid` para idempotencia de venta
3. Perfil fiscal colombiano (tax_mode, tax_category)
4. Audit logs
5. Metadatos de anulación (`void_reason`, `voided_at`)
6. Perfil comercial del tenant
7. Soporte de media/productos
8. Customers + Inventory (inventory_balances, inventory_transactions)
9. Tipos de documento fiscal DIAN (`INVOICE`, `CREDIT_NOTE`, `parent_document_id`)

---

### ✅ Frontend React + Vite PWA (95%)

| Módulo | Estado | Descripción |
|---|---|---|
| Auth | ✅ | Login + SessionProvider |
| POS | ✅ | Carrito, pago mixto, cambio COP |
| Historial | ⚠️ | Funcional — falta mostrar COP y badge DIAN |
| Productos | ✅ | CRUD, imagen, barcode, categoría fiscal |
| Clientes ⭐ | ✅ | Directorio NIT/CC integrado al checkout |
| Inventario ⭐ | ✅ | Balances y entradas de stock con alertas |
| Reportes ⭐ | ✅ | Dashboard: ingresos, ticket promedio, desglose pago |
| Caja | ✅ | Apertura / cierre / arqueo COP |
| Configuración | ✅ | Datos DIAN, ticket térmico, perfil comercial |

---

### ✅ Infraestructura Docker (100%)

- `infra/docker-compose.yml` — PostgreSQL 16, Redis 7, N8N
- `infra/postgres/init.sql` — Bootstrap UUID + extensiones
- `infra/redis/redis.conf` — Configuración Redis

---

## 2. Pendientes — Fases siguientes

### 🔴 Fase D — HistoryScreen (alta prioridad)

- [ ] Mostrar todos los importes en COP (actualmente en centavos sin formato)
- [ ] Badge de estado DIAN legible: `PENDING` / `ACCEPTED` / `REJECTED`
- [ ] Ver motivo de anulación en detalle de venta
- [ ] Corregir `any` en línea 414 (`HistoryScreen.tsx`)

### 🟡 Fase E — Administración (media prioridad)

- [ ] UI de gestión de usuarios (`/admin/users` existe en backend)
- [ ] UI de edición de sucursal (nombre, dirección, teléfono)
- [ ] UI de asignación de roles por usuario

### 🟡 Fase J — Calidad Técnica (media prioridad)

- [ ] Tests de integración para `reports.ts`, `customers.ts`, `inventory.ts`
- [x] Prueba E2E del flujo completo: login → apertura caja → venta → cierre caja
- [ ] Validar `ReportsScreen` con datos reales de DB
- [ ] Resolver documentos DIAN que queden en `SENT` mediante polling o webhook del provider

### 🟢 Fase K — Producción (próxima etapa)

- [ ] Dockerfiles de producción para `api`, `worker`, `pos-web`
- [ ] Documento `.env.production` con todas las variables requeridas
- [ ] CI/CD GitHub Actions (lint → test → build → deploy)
- [ ] Monitoreo frontend: Sentry DSN configurado
- [ ] Configurar DB y Redis remotos (RDS + ElastiCache o equivalente)
- [ ] Configurar proveedor DIAN real (`DIAN_PROVIDER=http`)
- [ ] Guía de go-live paso a paso

---

## 3. Variables de entorno

### `apps/api/.env`
```
DATABASE_URL=postgres://pos:pos@localhost:5432/pos_dian
REDIS_URL=redis://localhost:6379
JWT_SECRET=<secreto-largo>
CORS_ALLOWED_ORIGINS=http://localhost:5173
NODE_ENV=development
```

### `apps/worker/.env`
```
DATABASE_URL=postgres://pos:pos@localhost:5432/pos_dian
REDIS_URL=redis://localhost:6379
DIAN_PROVIDER=mock                 # 'http' en producción
DIAN_HTTP_URL=https://...          # URL del habilitador DIAN
DIAN_HTTP_API_KEY=                 # API Key del habilitador
DIAN_HTTP_TIMEOUT_MS=15000
OUTBOX_POLL_INTERVAL_MS=5000
OUTBOX_BATCH_SIZE=50
OUTBOX_RETRY_BASE_MS=30000
OUTBOX_RETRY_MAX_MS=3600000
```

---

## 4. Comandos rápidos

```bash
# Infraestructura local
docker compose -f infra/docker-compose.yml up -d

# Migraciones y seed
pnpm --filter @pos-dian/api db:migrate
pnpm --filter @pos-dian/api db:seed

# Desarrollo (todos los servicios)
pnpm dev

# Tests
pnpm test

# Build todo
pnpm build
```

---

## 5. Flujo DIAN — Diagrama simplificado

```
Venta creada
    ↓
API: INSERT sales + outbox_events (type=SALE_CREATED, status=PENDING)
    ↓
Worker scheduler: polling cada OUTBOX_POLL_INTERVAL_MS
    ↓
Worker: emitSale(INVOICE) → proveedor habilitador DIAN
    ↓
dian_documents: status PENDING → ACCEPTED | REJECTED

── Si la venta se anula ──────────────────────────────────────
API: UPDATE sales SET status=VOID + INSERT outbox_events (SALE_VOIDED)
    ↓
Worker: espera que dian_documents(INVOICE).status = ACCEPTED
    ↓
Worker: crea/reutiliza dian_documents(CREDIT_NOTE) y emitSale(CREDIT_NOTE) → proveedor
    ↓
dian_documents(CREDIT_NOTE): status PENDING → ACCEPTED | REJECTED
```

---

**Próximas acciones prioritarias**: HistoryScreen COP/badges → Admin UI → Tests → CI/CD → Go-live.
