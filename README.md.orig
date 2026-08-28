# POS DIAN - Colombia (SaaS Multi-Tenant)

Un Sistema de Punto de Venta (POS) y Gestión Hospitalaria (Hospitality & Retail) multi-tenant de alto rendimiento con emisión de facturación electrónica (DIAN) en Colombia. Diseñado con una arquitectura modular habilitable (Feature Flags), asíncrona, capacidades Offline-First PWA, observabilidad distribuida y preparado para la nube.

> **Estado actual (Agosto 2026):** funcionalmente completo y en endurecimiento previo a producción.
>
> Cerradas las fases 0, 1 y 2 del plan de `docs/ROADMAP-PRODUCCION.md`: el monorepo compila y pasa lint sin errores, el esquema se construye desde cero (90 migraciones), la suite corre verde (222 pruebas: 135 API contra PostgreSQL real, 41 worker, 28 pos-web, 18 shared) y CI ejecuta todo eso en cada PR.
>
> El cambio más importante de esta etapa: **la API dejó de conectarse con el dueño del esquema**. Ahora usa el rol `pos_api`, sin `BYPASSRLS`, de modo que el aislamiento por tenant lo aplica PostgreSQL y no la disciplina de quien escribe la consulta. Ver "Arquitectura Multi-Tenant" más abajo y D-036…D-044 en `docs/DECISIONS.md`.
>
> **Todavía no apto para facturar en producción:** faltan las fases 3 a 5 (operabilidad, certificación PAC real y escalado horizontal). El detalle está al final de este archivo.

---

## 📚 Documentación

| Archivo | Para qué sirve |
|---|---|
| `docs/ROADMAP-PRODUCCION.md` | **Empieza aquí si vuelves después de un tiempo.** Qué se cerró en las fases 0–2, con qué evidencia, qué falta en las 3–5, el plan on-premise y los criterios de salida a producción. |
| `docs/ARCHITECTURE.md` | Componentes, flujos de sistema, modelo de datos, y la explicación completa del aislamiento por tenant. |
| `docs/DECISIONS.md` | Registro de decisiones (ADR). Cuando algo del código parezca raro, la razón suele estar aquí. |
| `docs/RUNBOOK.md` | Procedimientos operativos: despliegue, migraciones, diagnóstico de RLS, cómo correr las pruebas. |
| `docs/API.md` | Contrato HTTP. |
| `MEMORY.md` | Decisiones core, lecciones aprendidas y auditorías pendientes, a alto nivel. |

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

- **Aislamiento por tenant (RLS), aplicado por el motor:** cada petición abre una transacción y fija `app.current_tenant` con `set_config(..., true)` a través de `executeAsTenant`. Las políticas comparan `tenant_id::text = current_setting('app.current_tenant', true)`; si nadie fijó la variable, `current_setting` devuelve `NULL`, la comparación es falsa y la consulta **no devuelve nada**. Falla cerrado, no abierto.
- **Dos conexiones, dos roles.** Es la pieza que hace real todo lo anterior:
  - `DATABASE_URL` → rol `pos_api`, **sin `BYPASSRLS` y sin DDL**. Es con el que corre la API. Todas las tablas de negocio están en `FORCE ROW LEVEL SECURITY`, así que ni siquiera un dueño accidental saltaría las políticas.
  - `ADMIN_DATABASE_URL` → rol dueño del esquema. Solo migraciones y semillas.
  - Hasta la fase 2 la API se conectaba con el dueño: el RLS estaba encendido pero era decorativo. Al mover la conexión aparecieron doce tablas sin política, seis que negaban todo (RESTRICTIVE sin permisiva) y dos que leían una variable que nadie fijaba —`tenant_dian_settings` entre ellas, es decir, cero credenciales del PAC y cero facturas—. La migración `088_rls_consistency` corrige las tres clases de defecto; `089_api_role_grants` reparte los permisos del rol.
- **Roles de aplicación:** gestión cruzada (`PLATFORM_OWNER`, `PLATFORM_ADMIN`) y roles granulares de negocio (`ADMIN`, `MANAGER`, `CASHIER`, `AUDITOR`).
- **Verificación viva:** `apps/api/src/shared/infra/db/__tests__/rls.spec.ts` prueba el aislamiento contra PostgreSQL real —lectura cruzada, `UPDATE`/`DELETE` ajenos, `INSERT` a nombre de otro, `COUNT(*)` sin `WHERE`— y aborta si el rol de conexión tiene `BYPASSRLS`, para que la suite no vuelva a pasar por accidente.
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

### 4. Dependencias
```bash
pnpm install
```

### 5. Base de Datos

Las migraciones y las semillas corren con el **rol dueño** (`ADMIN_DATABASE_URL`):

```bash
pnpm --filter @pos-dian/api db:migrate   # 90 migraciones, construye el esquema desde cero
pnpm --filter @pos-dian/api db:seed
```

### 6. Rol de conexión de la API

Este paso va **después** de migrar (el rol de grupo `api_user` lo crean las migraciones 057 y 089) y es lo que hace que el RLS sea real:

```bash
./infra/scripts/create-api-role.sh "$(openssl rand -base64 32)"
```

El script imprime `salta_rls`. Si sale `t`, algo está mal: el aislamiento entre comercios sería ficticio. Copia la contraseña generada a `DATABASE_URL` en tu `.env`; deja el rol dueño en `ADMIN_DATABASE_URL`.

> El worker sí usa el rol dueño: sus tareas programadas (bandeja de salida, rollups, renovaciones) recorren todos los comercios por diseño y no pueden estar sujetas al filtro por tenant.

### 7. Ejecutar en Modo Desarrollo
```bash
pnpm dev
```

### 8. Verificar
```bash
pnpm lint        # 0 errores
pnpm typecheck   # 0 errores
pnpm test        # 222 pruebas
```

Las pruebas del API y del worker corren contra PostgreSQL y Redis reales, no contra dobles. Necesitan `DATABASE_URL` y `ADMIN_DATABASE_URL` exportadas; Turbo filtra el entorno, así que toda variable que las pruebas necesiten tiene que estar declarada en `globalEnv` de `turbo.json` o simplemente no llega al proceso (y el código cae en sus valores por defecto sin avisar — nos costó una tarde). Detalle en `docs/RUNBOOK.md` → "Ejecutar las pruebas".

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
Variables requeridas: `DATABASE_URL` (rol `pos_api`, **sin `BYPASSRLS`**), `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `OTLP_TRACE_ENDPOINT` (opcional).

`ADMIN_DATABASE_URL` **no** se le pasa al contenedor de la API: las migraciones son un paso de despliegue aparte, no algo que la API haga al arrancar.

### Worker (BullMQ)
```bash
docker build -t pos-dian-worker -f apps/worker/Dockerfile .
```
Variables requeridas: `DATABASE_URL` (aquí sí el rol dueño: las tareas programadas recorren todos los comercios), `REDIS_URL`, `DIAN_PROVIDER`, `DIAN_HTTP_URL`, `CREDENTIALS_ENCRYPTION_KEY`.

Dos guardas que el worker impone al arrancar y conviene conocer antes del primer despliegue:

- `DIAN_PROVIDER=mock` **aborta** si `NODE_ENV=production`. Un worker productivo en modo mock devolvería CUDEs inventados y nadie se enteraría hasta la primera visita de la DIAN.
- Las credenciales del PAC en `tenant_dian_settings` se guardan cifradas (AES-256-GCM) con `CREDENTIALS_ENCRYPTION_KEY`. En producción, encontrar credenciales en texto plano es un error de arranque, no una advertencia. Para cifrar las existentes: `pnpm --filter @pos-dian/worker encrypt-credentials`. Genera la llave con `openssl rand -base64 32`.

> El worker expone `/health` en `$PORT` (default `8080`) para cumplir con SLA de plataformas PaaS (Render, Railway, DigitalOcean App Platform).

### Frontend Estático
```bash
VITE_API_URL=https://tu-api.com/api/v1 pnpm --filter @pos-dian/pos-web build
```
Desplegable en Vercel, Netlify o S3 + CloudFront.

### CI/CD
`.github/workflows/ci.yml` levanta PostgreSQL 16 y Redis 7 como servicios, migra con el rol dueño, crea `pos_api` con `create-api-role.sh` y corre `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm test` en cada PR hacia `main`. Las pruebas de RLS solo son significativas porque el paso del rol existe: sin él pasarían por accidente.

---

## ⚠️ Camino a Producción

El plan completo, con el porqué de cada ítem, está en **`docs/ROADMAP-PRODUCCION.md`**. Resumen del estado:

### Cerrado

| Fase | Qué se cerró |
|---|---|
| **0 — Que compile y se pueda verificar** | 59 errores de TypeScript a 0 · el esquema se construye desde cero (la migración 027 lo impedía) · suite verde en los cuatro paquetes · CI que efectivamente corre |
| **1 — Correcciones de negocio** | Alerta de bajo stock movida fuera de la transacción de inventario (insertaba en una columna inexistente y tumbaba el descargo y la emisión) · totales fiscales calculados por el servidor, nunca tomados del snapshot del cliente · `cash_ledger` registra solo el componente en efectivo · guarda de venta anulada antes de emitir · mock DIAN prohibido en producción · credenciales del PAC cifradas en reposo |
| **2 — RLS de verdad** | La API se conecta con `pos_api`, sin `BYPASSRLS` · migración 088 corrige 20 tablas (política ausente, variable equivocada, RESTRICTIVE sin permisiva) · `FORCE ROW LEVEL SECURITY` · pruebas de aislamiento reales con guarda de precondición |

### Pendiente

| Fase | Qué falta | Bloquea |
|---|---|---|
| **3 — Operabilidad** | Apagado ordenado (drenar jobs en vuelo), migraciones como paso de despliegue, `helmet`, autenticación en `/metrics`, quitar el JWT por query string en WebSockets, validar entropía de `JWT_SECRET`, `ErrorBoundary` en la PWA, gestión de secretos | Primer despliegue serio |
| **4 — Fiscal** | Certificación end-to-end con un PAC real · cierre del ciclo para documentos que quedan en `SENT` · control de resolución y prefijo de numeración · flujo domicilio → venta → DIAN | **Facturar legalmente** |
| **5 — Escalado** | Locks de asesoría en el worker, adaptador Redis para Socket.io, `SKIP LOCKED` en la bandeja de salida | Segunda instancia |

Fuera del plan por fases, sigue abierto lo operativo: HTTPS, rotación de usuarios, políticas de soporte y ensayo real de recuperación desde backup (el backup existe y se valida; la restauración nunca se ha ejecutado de punta a punta).
