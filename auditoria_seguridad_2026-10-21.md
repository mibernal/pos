# Auditoría de seguridad, bugs y mejoras — 21 de octubre de 2026

Rama: `fase-14/auditoria-onprem` (sale de `fase-11/frontend-sostenible`, que ya contiene las
fases 12 y 13). Revisión sobre el código actual, no sobre auditorías anteriores: las fases
0–13 cerraron la mayoría de lo que señalaban (RLS con FORCE, rol sin BYPASSRLS, valores
fiscales del servidor, CORS, SIGTERM, credenciales del PAC cifradas, etc.) y aquí no se
repite.

## Cómo se verificó

- `tsc --noEmit` de `api` (incluye `test/`), `pos-web` y `worker` (`tsconfig.build.json`).
- Barrido de rutas sin `preHandler` de autenticación (51 candidatas; revisadas a mano: las
  de plataforma se protegen por hook del contexto, el resto son públicas a propósito salvo
  las dos de suplantación).
- Búsqueda de `sql.raw`, `dangerouslySetInnerHTML`, tokens en `localStorage`, versiones de
  dependencias con avisos públicos.
- **No se ejecutaron** `pnpm lint` ni la suite (`pnpm test`, e2e): el entorno de revisión no
  tiene PostgreSQL y los binarios nativos de `node_modules` son de macOS. Hay que correrlos
  en tu equipo con el comando de `entorno_local` antes de fusionar.

## Hallazgos

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | **Alta** | `POST /auth/impersonate/exchange` era **pública**. Con el `session_id` se obtenía un token del dueño del comercio durante 1 h, reutilizable. El id queda en `audit_logs` (`USER_IMPERSONATED`), que el `ADMIN` del comercio lee con `audit:view`: un ADMIN podía hacerse TENANT_OWNER leyendo su auditoría. | Corregido: exige sesión de plataforma y que sea quien abrió la sesión; `session_id` validado como UUID. Prueba `impersonation-exchange.e2e.test.ts`. |
| 2 | **Alta** (operativa) | El typecheck de la API está roto desde la fase 13: 4 errores (`change-tenant-plan.use-case.ts` pasaba `string` a columnas `timestamptz`; `catalogo-permisos.test.ts` mezclaba `string`/`UserPermission`). CI no puede estar en verde. | Corregido. |
| 3 | **Alta** | Fastify sin `trustProxy`: detrás de nginx o de un balanceador `request.ip` es la del proxy. Todos los clientes comparten IP para los límites: **30 refrescos de sesión por minuto para toda la tienda** (429 en hora pico con varias tablets), registro y QR igual. | Corregido con `TRUST_PROXY` (por defecto apagado). **En la nube hay que fijarlo** al número de proxys delante de la API. |
| 4 | Media-alta | La importación masiva parsea XLSX/CSV de hasta **50 MB dentro del proceso de la API**, en el hilo principal: mientras dura, ninguna caja del servidor responde. Y usa `xlsx@0.18.5`, con CVE-2023-30533 (prototype pollution) y CVE-2024-22363 (ReDoS) — npm no tiene versión corregida. Exige `products:manage`, así que no es anónimo. | **Pendiente.** Mover el parseo al worker (ya existe `bulk-import-queue`), bajar el límite a ~10 MB y cambiar a SheetJS 0.20.3 desde `cdn.sheetjs.com` o a `exceljs`. |
| 5 | Media | `POST /auth/register` sin límite: cada llamada crea comercio, usuario, sede, medios de pago y envía un correo. Además el plan lo elige el cliente sin validar contra `billing_plans`. | Límite corregido (10/h por IP). Validar el plan del alta: pendiente. |
| 6 | Media | `POST /auth/impersonate/stop` público: cualquiera con el id cortaba la sesión de soporte de otro. | Corregido: solo quien la abrió o quien la usa. |
| 7 | Media | Riesgo abierto en `MEMORY.md`: `useCartStore` persistía `tableCarts` en el `localStorage` de cada tablet; al recargar, una tablet resucitaba su copia de la mesa y pisaba lo de otro mesero. | Corregido con `partialize` y migración `v1` que limpia lo ya guardado. Consecuencia buscada: un borrador de mesa **no enviado** se pierde al recargar. |
| 8 | Media | Exportar inventario a CSV no escapaba comillas (un nombre con `"` corría las columnas al reimportar), permitía inyección de fórmulas en Excel (`=HYPERLINK(…)`) y sin BOM los acentos salían rotos. | Corregido en exportación e importación. |
| 9 | Baja-media | En producción, sin `DATABASE_URL` la API caía al rol dueño `pos:pos`. | Corregido: producción exige un `DATABASE_URL` explícito. |
| 10 | Baja | `NOTIFICATION_PROVIDER=SENDGRID` es un adaptador vacío que descarta correos en silencio y pasaba la validación de producción. | Corregido: prohibido en producción. Nuevo `NONE` para instalaciones sin internet. |
| 11 | Baja | Healthcheck del worker: solo aceptaba `172.16.*`; las redes de Docker usan 172.17–172.31 → 403 desde otro contenedor en producción. | Corregido (172.16.0.0/12 completo). |
| 12 | Baja | `.dockerignore` no excluía `.env`: con `COPY . .` los secretos entraban en la capa de construcción y en la caché de BuildKit. | Corregido (también `storage`, capturas, etc.). |
| 13 | Baja | `kysely@0.27.6`: CVE-2026-32763 / 33468 / 33442 (inyección por literales y JSON path). Afectan a MySQL/SQLite, no a PostgreSQL con `standard_conforming_strings`. | Pendiente: subir a ≥ 0.28.14 en un PR propio (0.28 trae cambios de API). |
| 14 | Baja | `@fastify/jwt` está configurado para leer la cookie `access_token`, que nunca se emite. Código muerto que, si alguien la empieza a usar, abre CSRF en toda la API. | Pendiente: quitar la opción `cookie`. |
| 15 | Baja | KDS y turnos de meseros (`kds.api.ts`, `waiter-shifts.api.ts`) usan `fetch` directo en vez del cliente: sin refresco ante 401, sin `X-Request-Id`, y con `VITE_API_URL` sin valor por defecto. | Pendiente (fase 11 a medias). |
| 16 | Info | `/billing/mock-checkout` (aprueba pagos sin autenticación) solo se registra si `NODE_ENV !== 'production'`. Correcto, pero un despliegue con `NODE_ENV` mal puesto lo abre. | El instalador local fuerza `production`; en la nube, vigilar. |

## Criterios de salida que siguen abiertos (`docs/ROADMAP-PRODUCCION.md`)

Rotación de credenciales de ejemplo en entornos reales · `JWT_SECRET`/Postgres/Grafana
generados · ciclo fiscal con el PAC real (certificación) · restore probado en el último mes
(la instalación local ya lo automatiza: `validar-respaldo.sh`) · aceptación escrita de
instancia única hasta la fase 5.

## Instalación sin internet

Resuelta en esta misma rama: `onprem/` + `docs/INSTALACION-ONPREM.md`. Resumen de lo que
cambió en el código para soportarla: `DEPLOYMENT_MODE=onprem` (sin autoregistro, panel de
plataforma, checkout ni webhooks), licencia firmada Ed25519 que verifica el worker y nunca
apaga la caja, comando `provision-tenant` para crear el comercio al instalar, y
`NOTIFICATION_PROVIDER=NONE`.

## Antes de fusionar

```bash
pnpm install   # regenera el paquete inyectado de @pos-dian/api en el worker

# Opción recomendada (ejecuta lint, typecheck y test usando las variables locales):
pnpm lint && pnpm typecheck && pnpm test

# O con entorno limpio estricto (con las variables reales de .env, sin usar puntos suspensivos literales):
env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL='postgres://pos_api:pos_api@localhost:5432/pos_dian' \
  ADMIN_DATABASE_URL='postgres://pos:pos@localhost:5432/pos_dian' \
  REDIS_URL='redis://localhost:6379' \
  JWT_SECRET='CDj9dxfueaQVHTCFk2WUhkIH4B5FBL3rx2w7NFiczV8' \
  NODE_ENV=test \
  sh -c 'pnpm lint && pnpm typecheck && pnpm test'

# Regenerar contrato OpenAPI y tipos tipados del frontend:
pnpm --filter @pos-dian/api openapi:dump && pnpm --filter @pos-dian/pos-web api-types

# Verificar que los archivos generados estén al día:
git diff --exit-code -- openapi.json apps/pos-web/src/lib/api/schema.d.ts
```

