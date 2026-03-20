# RUNBOOK

## Arranque local
1. Levantar infraestructura:
   - `cd infra`
   - `docker compose up -d`
2. Volver al root e instalar dependencias:
   - `cd ..`
   - `pnpm install`
3. Ejecutar migraciones y seed demo:
   - `pnpm --filter @pos-dian/api db:migrate`
   - `pnpm --filter @pos-dian/api db:seed`
4. Levantar API, worker y web:
   - `pnpm dev`

## URLs locales
- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`
- POS web: `http://localhost:5173`

## Credenciales demo
- `ADMIN`: `admin@demo.posdian.local / Admin123*`
- `CASHIER`: `cashier@demo.posdian.local / Cashier123*`

## Variables minimas
### API
- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `AUTH_LOGIN_RATE_LIMIT_MAX`
- `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`

### Worker
- `DATABASE_URL`
- `REDIS_URL`
- `DIAN_PROVIDER=mock|http`
- `DIAN_HTTP_URL` cuando `DIAN_PROVIDER=http`

### POS web
- `VITE_API_URL=http://localhost:3000/api/v1`

## Demo operativa recomendada
1. Ingresar como `ADMIN`.
2. Abrir `Configuracion del negocio` y completar nombre comercial, NIT, direccion, telefono y mensaje final.
3. Abrir `Configuracion DIAN` y definir modo fiscal.
4. Ir a `Productos` y ajustar `tax_category` de los SKU de demo.
5. Abrir caja en la sucursal demo.
6. Vender desde `Caja principal`.
7. Reimprimir o anular desde `Historial`.
8. Cerrar caja para mostrar arqueo final.

## Configurar restaurante
1. Entrar como `ADMIN`.
2. Ir a `Configuracion DIAN`.
3. Seleccionar `INC_RESTAURANT`.
4. En `Productos`, usar `INC_8` para productos gravados con INC.
5. Validar en ticket el texto `Incluye INC`.

## Configurar tienda o carniceria
1. Entrar como `ADMIN`.
2. Ir a `Configuracion DIAN`.
3. Seleccionar `IVA`.
4. En `Productos`, asignar por SKU:
   - `IVA_19`
   - `IVA_5`
   - `IVA_0`
   - `EXEMPT`
   - `EXCLUDED`
5. Validar en ticket el texto `Incluye IVA`.

## Abrir caja
1. Ingresar como `ADMIN` o `CASHIER`.
2. Seleccionar la sucursal.
3. Abrir caja con monto inicial en `opening_amount_cents`.
4. Validar que la web muestre caja activa y habilite la pantalla POS.

## Vender
1. Buscar por nombre o codigo de barras.
2. Agregar productos al carrito.
3. Ajustar cantidades o eliminar items.
4. Aplicar descuento total si aplica.
5. Presionar `Cobrar`.
6. Elegir medio de pago:
   - efectivo
   - tarjeta
   - transferencia
   - mixto
7. Confirmar que la suma de pagos coincida con el total.
8. Finalizar venta e imprimir ticket si aplica.

## Flujo offline y sincronizacion
1. Si `POST /sales` falla por red, la venta queda en cola local con su `client_uuid`.
2. La web muestra contador de pendientes y el boton `Sincronizar`.
3. Al volver la conexion, la sincronizacion puede dispararse sola o manualmente.
4. Si backend ya conoce el `client_uuid`, la venta se considera sincronizada y no se duplica.
5. Si una pendiente falla, queda con error visible y se puede reintentar.

## Historial, reimpresion y anulacion
1. Abrir `Historial`.
2. Filtrar por fecha y limite.
3. Seleccionar una venta para ver items, pagos, impuestos, estado DIAN y CUDE.
4. Usar `Reimprimir ticket` para reimpresion.
5. Solo `ADMIN` puede usar `Anular venta`.
6. La anulacion exige motivo, refresca el detalle y marca la venta como `VOID`.
7. Si existe documento DIAN, la UI deja visible que falta gestionar la nota de ajuste real.

## Cierre de caja
1. Consultar la caja actual de la sucursal.
2. Registrar `closing_cash_real_cents`.
3. Revisar `expected_cash_cents` y `diff_cents`.
4. Confirmar cierre.

## Verificaciones tecnicas utiles
- Health: `GET /api/v1/health`
- Caja actual: `GET /api/v1/cash-sessions/current?branch_id=<branch_id>`
- Historial: `GET /api/v1/sales?branch_id=<branch_id>&limit=50`
- Swagger: `http://localhost:3000/docs`

## Fallas comunes
- `401` al sincronizar pendientes: la sesion expiro; iniciar sesion de nuevo.
- `CASH_SESSION_ALREADY_OPEN`: ya existe una caja abierta en esa sucursal.
- `CASH_SESSION_CLOSED`: la venta intento usar una caja cerrada.
- Sin estado DIAN final: revisar worker, Redis y `DIAN_PROVIDER`.
- Pendientes que no sincronizan: revisar conectividad, API y errores guardados en la cola local.

## Pendientes para produccion final
- Provider DIAN real y flujo formal de nota de ajuste para anulaciones.
- Despliegue con HTTPS, secretos, backups y monitoreo centralizado.
- Impresion integrada con hardware o ESC/POS si se requiere fuera del navegador.
- Politicas operativas de soporte, rotacion de usuarios y recuperacion de incidentes.
