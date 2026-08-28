# RUNBOOK

> Guía operativa para desarrollo local, demo, operación de caja y diagnóstico de problemas.

---

## Arranque Local

### 1. Infraestructura Core (PostgreSQL + Redis)

```bash
cd infra
docker compose up -d
cd ..
```

Verifica que los contenedores estén en estado `running`:
```bash
docker ps --filter "name=pos-dian"
```

### 2. Infraestructura de Observabilidad (Opcional)

Levanta el stack OpenTelemetry → Prometheus → Grafana + Tempo + Loki:

```bash
cd infra
docker compose -f docker-compose.obs.yml up -d
cd ..
```

| Servicio | URL | Credenciales |
|---|---|---|
| Grafana | http://localhost:3100 | `admin` / `admin` |
| Prometheus | http://localhost:9090 | — |
| OTel Collector | http://localhost:4318 | — |

> **Nota:** Grafana en `3100` para no colisionar con la API en `3000`.

### 3. Dependencias

```bash
pnpm install
```

Requiere pnpm `10.x`. Instalar con: `npm install -g pnpm@latest`

### 4. Migraciones, rol de la API y semilla demo

```bash
# Migra con el rol dueño del esquema (ADMIN_DATABASE_URL)
pnpm --filter @pos-dian/api db:migrate

# Crea el rol con el que se conecta la API: SIN BYPASSRLS.
# Debe ir DESPUÉS de migrar: el rol `api_user` lo definen las migraciones 057/089.
DATABASE_URL=$ADMIN_DATABASE_URL ./infra/scripts/create-api-role.sh pos_api

pnpm --filter @pos-dian/api db:seed
```

> **Por qué dos conexiones.** La API usa `DATABASE_URL` con un rol restringido, de modo
> que el aislamiento entre comercios lo imponga PostgreSQL y no dependa de que ninguna
> consulta olvide su `WHERE tenant_id`. Migraciones, semillas y el worker usan
> `ADMIN_DATABASE_URL` (el rol dueño): hacen DDL y leen a través de todos los comercios,
> cosa que el rol de la API no puede —ni debe— hacer. Ver D-036 en `docs/DECISIONS.md`.

Verificación rápida de que el rol es el correcto:

```bash
psql "$ADMIN_DATABASE_URL" -c \
  "SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname='pos_api';"
# rolbypassrls debe ser 'f'. Si es 't', el aislamiento es ficticio.
```

### 5. Arrancar en Modo Desarrollo

```bash
pnpm dev
```

Turborepo levanta `api` (`:3000`), `worker` y `pos-web` (`:5173`) en paralelo.

---

## URLs Locales

| Servicio | URL |
|---|---|
| POS Web | http://localhost:5173 |
| API REST | http://localhost:3000 |
| Swagger UI | http://localhost:3000/docs |
| Health check | http://localhost:3000/api/v1/health |
| Grafana | http://localhost:3100 |
| Prometheus | http://localhost:9090 |

---

## Credenciales Demo

| Rol | Email | Contraseña |
|---|---|---|
| `ADMIN` | `admin@demo.posdian.local` | `Admin123*` |
| `CASHIER` | `cashier@demo.posdian.local` | `Cashier123*` |

---

## Variables de Entorno Mínimas

### API (`apps/api/.env`)
```env
DATABASE_URL=postgresql://pos_user:pos_password@localhost:5432/pos_dian
REDIS_URL=redis://localhost:6379
JWT_SECRET=<secreto-seguro>
CORS_ALLOWED_ORIGINS=http://localhost:5173
AUTH_LOGIN_RATE_LIMIT_MAX=10
AUTH_LOGIN_RATE_LIMIT_WINDOW_MS=60000
# Observabilidad (opcional)
OTLP_TRACE_ENDPOINT=http://localhost:4318/v1/traces
OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
```

### Worker (`apps/worker/.env`)
```env
DATABASE_URL=postgresql://pos_user:pos_password@localhost:5432/pos_dian
REDIS_URL=redis://localhost:6379
DIAN_PROVIDER=mock
# Si DIAN_PROVIDER=http:
DIAN_HTTP_URL=https://tu-pac-dian.com/api
```

### POS Web (`apps/pos-web/.env`)
```env
VITE_API_URL=http://localhost:3000/api/v1
```

---

## Demo Operativa

### Operación Platform / SuperAdmin

1. Entrar como `PLATFORM_OWNER` (`superadmin@demo.posdian.local`).
2. Ir a **Platform** (Dashboard de SuperAdmin).
3. En la lista de Tenants, haz clic en **View** para abrir el *Tenant Detail Drawer*.
4. **Configuración de Cuenta:** Usa el Drawer para suspender la cuenta temporalmente, reactivarla o cambiar su plan de suscripción (`STARTER`, `PRO`, `ENTERPRISE`).
5. **Gestión de Usuarios (Pestaña USERS):** Visualiza los usuarios de ese tenant. Como SuperAdmin, puedes añadir usuarios nuevos o editar contraseñas en nombre del cliente si éste pierde el acceso.

### Configuración Inicial (ADMIN)

1. Entrar como `ADMIN`.
2. Ir a **Configuración del Negocio** → completar NIT, nombre comercial, dirección, teléfono, mensaje de pie de ticket.
3. Seleccionar tamaño de impresora: `58mm` u `80mm`.
4. Ir a **Configuración DIAN** → seleccionar modo fiscal.
5. Ir a **Productos** → asignar `tax_category` a cada SKU.

### Configurar Restaurante (INC)

1. **Configuración DIAN** → `INC_RESTAURANT`.
2. En productos que aplican, asignar `INC_8`.
3. Validar en el ticket el texto `Incluye INC`.

### Configurar Tienda / Carnicería (IVA mixto)

1. **Configuración DIAN** → `IVA`.
2. En productos, asignar: `IVA_19`, `IVA_5`, `IVA_0`, `EXEMPT` o `EXCLUDED` según corresponda.
3. Validar en el ticket el texto `Incluye IVA`.

---

## Operación de Caja

### Abrir Caja
1. Ingresar como `ADMIN` o `CASHIER`.
2. Seleccionar sucursal.
3. Ingresar `opening_amount_cents` (monto de apertura).
4. La pantalla POS se habilita al confirmar.

### Vender (Flujo Teclado-Only — Objetivo < 5 segundos)

| Paso | Acción | Atajo |
|---|---|---|
| 1 | Enfocar buscador | `Ctrl+K` |
| 2 | Buscar producto | Teclear nombre, barcode o `QTY*BARCODE` |
| 3 | Navegar resultados | `↑ / ↓` |
| 4 | Agregar al carrito | `Enter` |
| 5 | Abrir cobro | `F4` |
| 6 | Seleccionar medio de pago | `F1` Efectivo · `F2` Tarjeta · `F3` Transferencia · `F4` Mixto |
| 7 | Confirmar venta | `Enter` |

**Multiplicador de Escáner:** Teclea `5*7701234567890` + Enter para agregar 5 unidades de ese código de barras en un solo paso. Funciona también con el escáner físico si envía el prefijo.

**Botones rápidos de billete (Efectivo):** Exacto · $20.000 · $50.000 · $100.000 — auto-completan el campo de monto recibido.

### Leer Báscula Digital (Web Serial API)

1. Conecta la báscula al puerto USB/Serial.
2. En el carrito, selecciona el ítem de venta a peso.
3. Haz clic en el botón de báscula (ícono de balanza) junto al ítem.
4. El navegador solicitará permiso de acceso al puerto serial.
5. El peso se aplica automáticamente como cantidad del ítem.

> **Requisito:** Sólo disponible en Chrome/Edge en escritorio. baudRate 9600.

### Cerrar Caja
1. Consultar la caja actual de la sucursal.
2. Ingresar `closing_cash_real_cents`.
3. Revisar `expected_cash_cents` y `diff_cents`.
4. Confirmar cierre.

---

## Flujo Offline y Sincronización

1. Si `POST /sales` falla por red, la venta queda en cola local con su `client_uuid`.
2. La web muestra contador de pendientes y botón **Sincronizar**.
3. Al volver la conexión, la sincronización se dispara automáticamente (listener `window.online`).
4. Si el backend ya conoce ese `client_uuid` (HTTP 409), la venta se considera sincronizada sin duplicar.
5. Si una pendiente falla, queda con error visible y se puede reintentar individualmente.
6. Después de 5 intentos fallidos, el estado pasa a `ABORTED`; requiere intervención manual.

> **Nota:** Si la cola no sincroniza correctamente en Safari (iOS), verificar que `navigator.storage.persist()` haya sido concedido (ver consola del navegador al cargar el POS).

---

## Historial, Reimpresión y Anulación

1. Abrir **Historial**.
2. Filtrar por fecha y límite.
3. Seleccionar una venta para ver items, pagos, impuestos, estado DIAN y CUDE.
4. Usar **Reimprimir ticket** para reimpresión.
5. Solo `ADMIN` puede usar **Anular venta** (requiere motivo).
6. La anulación marca la venta como `VOID`, repone inventario y crea outbox `SALE_VOIDED`.
7. El worker emitirá una `CREDIT_NOTE` separada cuando la `INVOICE` esté `ACCEPTED`.

---

## Operación DIAN y Outbox

1. Verificar que API y worker compartan `DATABASE_URL`.
2. Verificar que worker tenga `REDIS_URL` y `DIAN_PROVIDER`.
3. Para ventas nuevas: `outbox_events.type = SALE_CREATED`.
4. Para anulaciones: `outbox_events.type = SALE_VOIDED`.
5. `SALE_VOIDED` puede quedar en retry si la `INVOICE` original aún no está `ACCEPTED`.
6. Con `DIAN_PROVIDER=http`, la respuesta debe traer `status` válido: `SENT`, `ACCEPTED` o `REJECTED`.
7. Si el provider responde `ACCEPTED`, debe traer `cude`, `CUDE` o `uuid`; si no, el worker falla y reintenta.

---

## Operación BullMQ (Cargas Masivas)

El Worker también escucha la cola `bulk-import-queue` para la subida de inventarios de más de 50k productos.
* **Monitoreo:** El progreso se lee desde el API consultando el job en Redis (`/api/v1/inventory/bulk-import/:id`).
* **Concurrencia:** Limitado a 2 trabajos en paralelo para proteger PostgreSQL.
* **Destrabar:** Si un job se queda *stalled*, borrar la key `bull:bulk-import-queue:*` en Redis vía `redis-cli FLUSHALL` (en desarrollo local) o reiniciar el worker.

---

## Observabilidad (Grafana)

1. Levanta el stack: `cd infra && docker compose -f docker-compose.obs.yml up -d`.
2. Abre Grafana en http://localhost:3100 (admin/admin).
3. Las trazas HTTP del API aparecen en **Explore → Tempo**.
4. Las métricas de negocio (`pos.sales.count`) aparecen en **Explore → Prometheus**.
5. Los logs estructurados aparecen en **Explore → Loki** (si el API tiene configurado el log exporter).

Para enviar trazas del API al collector, asegúrate de que en `apps/api/.env`:
```env
OTLP_TRACE_ENDPOINT=http://localhost:4318/v1/traces
OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
```

---

## Verificaciones Técnicas Rápidas

```bash
# Health del API
curl http://localhost:3000/api/v1/health

# Caja actual
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/v1/cash-sessions/current?branch_id=<branch_id>"

# Últimas ventas
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/v1/sales?branch_id=<branch_id>&limit=10"

# Swagger
open http://localhost:3000/docs
```

---

## Fallas Comunes y Soluciones

| Error | Causa | Solución |
|---|---|---|
| `401` al sincronizar pendientes | Sesión expirada | Iniciar sesión de nuevo; la cola continuará automáticamente |
| `CASH_SESSION_ALREADY_OPEN` | Ya existe una caja abierta en esa sucursal | Cerrar la sesión existente o usar la misma |
| `CASH_SESSION_CLOSED` | La venta intentó usar una caja cerrada | Abrir una nueva caja |
| Sin estado DIAN final | Worker detenido, Redis caído o `DIAN_PROVIDER` incorrecto | Verificar `docker ps`, logs del worker y env vars |
| Documento DIAN en `SENT` por mucho tiempo | Falta implementar consulta/webhook de finalización del PAC | Pendiente de producción (D-003) |
| `SALE_VOIDED` reintentando | La `INVOICE` de la venta aún no está `ACCEPTED` | Esperar a que el worker procese la factura original |
| Importación Masiva congelada | OOM en Worker o Redis caído | Subir RAM al worker, verificar `REDIS_URL` |
| Webhook Wompi/MercadoPago no llega | URL de callback inaccesible desde internet | Exponer puerto 3000 con `ngrok` y registrar URL en el Gateway |
| Provider HTTP falla por status inválido | Contrato de respuesta del PAC no mapeado | Revisar mapeo en `dian-http.provider.ts` |
| Cola offline no persiste en iOS | Safari purgó IndexedDB por falta de espacio | Verificar en consola: `navigator.storage.persist()` debe retornar `true` |
| Error `ERR_MODULE_NOT_FOUND` al migrar | Dependencias OpenTelemetry no instaladas | `pnpm install` en el root del monorepo |

---

## Pendientes para Producción

Plan completo, con el porqué de cada ítem y los criterios de salida, en **`docs/ROADMAP-PRODUCCION.md`**. Resumen operativo:

- [x] ~~Backups automáticos~~ — Implementado (GitHub Actions + GCS). **Pero la restauración nunca se ha ensayado de punta a punta**; hacerlo es requisito de salida.
- [x] ~~El esquema se construye desde cero y CI lo verifica~~ — Fase 0.
- [x] ~~Ningún valor fiscal proviene del cliente; credenciales del PAC cifradas~~ — Fase 1.
- [x] ~~La API corre con un rol sin `BYPASSRLS`~~ — Fase 2. Ver "Diagnóstico de aislamiento por tenant (RLS)" más abajo.
- [x] ~~Apagado ordenado en la API (`SIGTERM` → drenaje) y comando documentado de migración en un servidor productivo~~ — Fase 3.
- [x] ~~`helmet`, `/metrics` autenticado, token de sesión fuera del query string, validación de entropía de `JWT_SECRET`~~ — Fase 3.
- [ ] Gestión de secretos (Vault / GCP Secret Manager); rotar en los entornos reales toda credencial de ejemplo del repositorio. Es trabajo de infraestructura, no de código.
- [ ] Provider DIAN real certificado y cierre del ciclo para documentos en `SENT`; control de resolución y consecutivo — Fase 4. **Bloquea facturar legalmente.**
- [ ] Instancia única hasta completar la Fase 5 (advisory locks, adaptador Redis de Socket.io, `SKIP LOCKED`). Debe estar aceptado por escrito.
- [ ] Despliegue con HTTPS y monitoreo centralizado en la nube.
- [ ] Políticas operativas: soporte, rotación de usuarios y recuperación de incidentes.
- [ ] Impresión ESC/POS integrada en el flujo de caja (actualmente requiere confirmación manual del puerto serial).

---

## Operación de Backup y Recuperación

### Verificar que el backup diario está funcionando

1. Ir a **GitHub → Actions → Database Backup**.
2. Confirmar que el último run tiene estado `✅ success`.
3. El backup se ejecuta todos los días a las **02:00 UTC** (9 PM Colombia).

### Ejecutar backup manual

```bash
# Desde entorno con acceso a la DB de producción y gcloud autenticado
export DATABASE_URL="postgres://..."
export GCS_BUCKET="gs://pos-dian-backups"
bash infra/scripts/pg-backup-gcs.sh
```

### Listar backups disponibles

```bash
gsutil ls gs://pos-dian-backups/postgres/ | sort
```

### Restore de emergencia

```bash
# 1. Descargar el backup a usar
gsutil ls gs://pos-dian-backups/postgres/ | sort | tail -5

# 2. Ejecutar restore (pedirá confirmación interactiva)
export DATABASE_URL="postgres://pos:PASS@host:5432/pos_dian"
bash infra/scripts/pg-restore.sh gs://pos-dian-backups/postgres/pos_dian_YYYYMMDD_HHMMSS.dump

# 3. Tras el restore, ejecutar migraciones pendientes
pnpm --filter @pos-dian/api migrate
```

> ⚠️ **El restore elimina TODOS los datos actuales en la DB destino. Siempre hacer un backup previo antes de restaurar en producción.**

### Validación de integridad manual

```bash
# Descarga el backup más reciente y lo restaura en una DB temporal para verificar
export DATABASE_URL="postgres://pos:PASS@localhost:5432/pos_dian"
export GCS_BUCKET="gs://pos-dian-backups"
export PGDATABASE="pos_dian"
bash infra/scripts/pg-validate-restore.sh
```

### Fallo del backup: checklist

| Síntoma | Causa probable | Solución |
|---|---|---|
| GitHub Action falla en auth | `GCP_SA_KEY` expirado o revocado | Rotar Service Account en GCP Console |
| `pg_dump` falla | `DATABASE_URL_PRODUCTION` incorrecto o DB caída | Verificar conectividad y credenciales |
| `gsutil cp` falla | Sin permisos en bucket | Verificar que SA tiene rol `Storage Object Admin` |
| Validación falla | Backup corrupto o migraciones faltantes | Investigar el dump anterior; contactar DBA |

---

## Observabilidad y Rendimiento (Métricas y Traces)

El sistema de observabilidad (Prometheus, Loki, Tempo, OpenTelemetry) puede ser un generador importante de costos si se deja encendido permanentemente en producción. 

### Directrices para Producción (10 a 50 clientes SaaS)

1. **Desactivar Tracing Completo:** Mantén la variable `ENABLE_TRACING=false` en Producción. OpenTelemetry inyecta carga en cada request HTTP y DB query.
2. **Logs a Stdout:** Mantén la variable `ENABLE_LOKI=false` en Producción. `pino-loki` está pensado para desarrollo y staging. En Producción, los logs estructurados JSON salen por `stdout` de Node.js y deben ser capturados por el agente del entorno (CloudWatch, GCP Logging, Datadog Agent, o Promtail).
3. **Métricas de Negocio (Opcional):** Si usas Prometheus para métricas agregadas de negocio, mantén `docker-compose.obs.yml` pero **sin** Loki y Tempo.

### Encender Depuración Profunda (Troubleshooting)

Si necesitas investigar un cuello de botella o fuga de memoria:

1. Modificar el `.env` de producción temporalmente:
   ```env
   ENABLE_TRACING=true
   ```
2. Desplegar los componentes de observabilidad bajo demanda:
   ```bash
   docker-compose -f infra/docker-compose.obs.yml up -d otel-collector tempo prometheus grafana
   ```
3. Recordar apagar la infraestructura y revertir `.env` una vez localizado el error para ahorrar costos (un servidor Tempo y Loki en alto volumen puede costar igual que el propio servidor de la DB).

---

## Diagnóstico de aislamiento por tenant (RLS)

**Síntoma: un módulo aparece vacío (mesas, cocina, domicilios, meseros) aunque hay datos.**
Casi siempre es una consulta que no pasa por `executeAsTenant()`, o una política que usa
una variable distinta de `app.current_tenant`. Comprobar:

```sql
-- Políticas mal configuradas: no debería devolver ninguna fila
SELECT tablename, policyname, permissive
FROM pg_policies
WHERE schemaname='public'
  AND (permissive='RESTRICTIVE' OR qual LIKE '%app.current_tenant_id%');

-- Tablas con tenant_id que quedaron sin RLS
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN information_schema.columns col
  ON col.table_name = c.relname AND col.table_schema='public' AND col.column_name='tenant_id'
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND col.is_nullable='NO';
```

Las exclusiones legítimas están en D-038; cualquier otra tabla en esa lista es un hallazgo.

**Síntoma: la API devuelve 500 con «permission denied for table X».**
El rol `api_user` no tiene permisos sobre una tabla creada por una migración posterior.
Se resuelve volviendo a correr la migración 089, que refresca los `GRANT`.

**Síntoma: no se emite ninguna factura y el log dice que faltan las credenciales DIAN.**
Con RLS aplicado, `tenant_dian_settings` solo es legible dentro del contexto del comercio.
Verificar también que las credenciales estén cifradas (D-040):

```bash
# Genera una clave para CREDENTIALS_ENCRYPTION_KEY
pnpm --filter @pos-dian/worker encrypt-credentials

# Cifra un objeto de credenciales
CREDENTIALS_ENCRYPTION_KEY=... pnpm --filter @pos-dian/worker encrypt-credentials \
  '{"username":"...","access_key":"..."}'
```

---

## Ejecutar las pruebas

Las pruebas de la API corren contra PostgreSQL real y con el **rol restringido**, para que
una regresión de aislamiento haga fallar la suite:

```bash
docker compose -f infra/docker-compose.yml up -d
pnpm --filter @pos-dian/api db:migrate
DATABASE_URL=$ADMIN_DATABASE_URL ./infra/scripts/create-api-role.sh pos_api
pnpm test
```

`turbo.json` declara en `globalEnv` las variables que las tareas necesitan ver. Turbo 2
filtra el entorno por defecto: una variable no declarada ahí **no llega** a los scripts y
el código cae a sus valores por defecto —cosa que ya ocurrió una vez, haciendo que las
pruebas corrieran contra el rol dueño sin que nadie lo notara.


---

## Despliegue y ciclo de vida del proceso (fase 3)

### Migrar antes de arrancar

El migrador es un entrypoint independiente y **no** carga la configuración de la aplicación: solo necesita la conexión del dueño del esquema. Eso permite correrlo como contenedor de un solo uso sin repartirle la clave de Resend ni el proveedor DIAN.

```bash
# dentro del contenedor de la API, con el bundle ya compilado
ADMIN_DATABASE_URL=postgres://pos:<clave>@db:5432/pos_dian \
  node dist/shared/infra/db/migrate.js

# o, desde el monorepo
pnpm --filter @pos-dian/api db:migrate:prod
```

Si falta la variable, falla de inmediato con un mensaje que lo dice. Es el mismo comando que verifica CI en cada PR.

En Compose o Kubernetes va como paso previo:

```yaml
  migrate:
    image: pos-dian-api
    command: ["node", "dist/shared/infra/db/migrate.js"]
    environment:
      ADMIN_DATABASE_URL: postgres://pos:...@db:5432/pos_dian
    depends_on:
      postgres: { condition: service_healthy }

  api:
    depends_on:
      migrate: { condition: service_completed_successfully }
```

**Después de un despliegue que añade tablas**, correr también la migración de permisos —ya incluida como `089`— es automático; solo hace falta volver a ejecutar `create-api-role.sh` si se rota la contraseña de `pos_api`.

### Despliegue en caliente

La API atiende `SIGTERM` y `SIGINT`:

1. Deja de aceptar conexiones nuevas.
2. Espera a que terminen las peticiones en vuelo (incluido un `POST /sales` a medio confirmar).
3. Cierra la cola de BullMQ, la conexión de Redis y el pool de Postgres.
4. Sale con código 0.

Si el drenaje excede `SHUTDOWN_TIMEOUT_MS` (25 s por defecto), registra `El cierre ordenado excedió su plazo` y sale con 1. El plazo está por debajo de los 30 s que espera un orquestador antes del `SIGKILL`; si se aumenta, hay que aumentar también `terminationGracePeriodSeconds` o el equivalente de la plataforma.

Comprobación rápida en un servidor:

```bash
kill -TERM <pid>
# en el log:  "Cierre ordenado iniciado: no se aceptan peticiones nuevas"
# código de salida esperado: 0
```

### Consultar `/metrics` en producción

Fuera de producción el endpoint está abierto. En producción exige `METRICS_TOKEN`:

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.ejemplo.co/metrics
```

Si el endpoint devuelve **404**, la causa más probable no es la ruta sino que `METRICS_TOKEN` no está configurado: en ese caso se oculta a propósito, para no confirmar que existe. Un **401** significa que el token no coincide.

### Secretos que el arranque rechaza

En producción la API no arranca si:

| Variable | Regla |
|---|---|
| `JWT_SECRET` | mínimo 32 caracteres, **y** ni marcador de posición (`replace`, `change`, `example`, `default`, …) ni menos de 16 caracteres distintos |
| `CORS_ALLOWED_ORIGINS` | obligatorio y no vacío |
| `DIAN_PROVIDER` | no puede ser `mock` |
| `RESEND_API_KEY` | obligatorio si `NOTIFICATION_PROVIDER=RESEND` |

Generar secretos: `openssl rand -base64 48` (JWT), `openssl rand -hex 24` (métricas).

---

## Meseros: cómo funciona y qué revisar

Dos conceptos distintos que conviene no confundir (D-046):

- **Mesero** (`waiters`): una fila de la plantilla de la sucursal, con nombre y PIN opcional. Es lo que se asigna a una mesa. Se administra en **Meseros**, que requiere el módulo `waiters` activo y el permiso `branches:manage`.
- **Usuario con rol `WAITER`**: una cuenta de acceso a la aplicación, para el mesero que además usa una tablet. Se crea en **Usuarios**; la opción solo aparece si el módulo `waiters` está activo.

No hace falta lo segundo para lo primero. La mayoría de los meseros no necesita cuenta.

### «No aparece ningún mesero para asignar»

1. ¿El comercio tiene `enable_waiters`? Sin el módulo, la asignación no se ofrece y las mesas se abren sin mesero (es el comportamiento correcto, no un fallo).
2. ¿Hay filas en `waiters` para esa sucursal, activas?

   ```sql
   SELECT id, name, is_active FROM waiters
   WHERE tenant_id = '<tenant>' AND branch_id = '<sucursal>';
   ```

3. Si la lista está vacía, se agregan en la pantalla **Meseros**. Crear usuarios con rol `WAITER` **no** los añade a esta lista.

### «No aparece la opción de mesero al crear un usuario»

Depende del módulo `waiters` del comercio. Se comprueba con:

```sql
SELECT enable_tables, enable_waiters FROM tenants WHERE id = '<tenant>';
```

El flag se activa desde el SuperAdmin de plataforma. Activar `enable_waiters` activa `enable_tables` en cascada (la dependencia está declarada en `TenantModuleDependencyResolver`).
