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

### 4. Migraciones y Semilla Demo

```bash
pnpm --filter @pos-dian/api db:migrate
pnpm --filter @pos-dian/api db:seed
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

- [ ] Provider DIAN real certificado y flujo de finalización para documentos `SENT`.
- [ ] Despliegue con HTTPS, gestión de secretos (Vault / GCP Secret Manager) y monitoreo centralizado en la nube.
- [ ] Políticas operativas: soporte, rotación de usuarios y recuperación de incidentes.
- [ ] Impresión ESC/POS integrada en el flujo de caja (actualmente requiere confirmación manual del puerto serial).
- [x] ~~Backups automáticos~~ — Implementado (GitHub Actions + GCS).

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

