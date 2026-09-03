# Credenciales: qué hace falta y cómo se genera

Todas las variables viven en `.env` (local) y `.env.example` (plantilla versionada, sin
secretos). Los dos archivos se generan con la misma plantilla:

```bash
node scripts/reorganizar-env.mjs           # muestra qué falta, qué sobra y qué está duplicado
node scripts/reorganizar-env.mjs --write   # reescribe ambos (deja .env.bak)
```

El script conserva los valores que ya estaban y **nunca escribe un secreto de ejemplo como
valor real**: un secreto que falta queda vacío. Una cadena tipo `GENERAR_CON_...` puesta como
valor sería una clave funcional y conocida, y nadie lo notaría hasta leer el archivo.

Las variables ausentes toman el valor por defecto que declara el código
(`apps/api/src/app/env.ts` y `apps/worker/src/config/env.ts`). Ojo con una diferencia que ya
costó un arranque roto: en un `.env`, `FOO=` es **cadena vacía** para Node, no «sin
configurar». El código la normaliza a `undefined` antes de validar, pero si una variable no
se usa, lo limpio es borrar la línea.

---

## 1. Las que generas tú, ahora, sin cuenta en ningún lado

Cuatro comandos. Cada valor es independiente: no reutilices uno para otra cosa.

```bash
# JWT_SECRET — firma los tokens de sesión de todos los comercios
openssl rand -base64 48

# CREDENTIALS_ENCRYPTION_KEY — AES-256-GCM para las credenciales del PAC
openssl rand -hex 32

# DIAN_WEBHOOK_SECRET — HMAC-SHA256 del webhook de estado del PAC
openssl rand -hex 32

# METRICS_TOKEN — protege /metrics en producción (mínimo 16 caracteres)
openssl rand -hex 24

# POSTGRES_PASSWORD y la contraseña del rol de la API
openssl rand -base64 32
```

Tres detalles que el código comprueba y conviene conocer:

**`JWT_SECRET` se valida por variedad, no por longitud.** En producción se rechaza si el
valor parece un marcador (`replace`, `change`, `example`, `your-`, `test`, `demo`…) o si
tiene menos de 16 caracteres distintos. Un secreto de 32 caracteres puede seguir siendo
trivial, y el del repositorio lo conoce cualquiera que haya visto el proyecto: firmar con él
equivale a no firmar.

**`CREDENTIALS_ENCRYPTION_KEY` es obligatoria en producción.** Sin ella, las credenciales que
cada comercio guarda para su PAC quedarían en texto plano en la base de datos. El worker se
niega a arrancar. Para cifrar las que ya existan en claro:

```bash
pnpm --filter @pos-dian/worker encrypt-credentials
```

**`METRICS_TOKEN` sin configurar cierra `/metrics` con un 404** en producción, en vez de
exponerlo. Las métricas de Prometheus incluyen rutas, latencias y volumen por endpoint:
reconocimiento gratuito para quien encuentre el puerto.

---

## 2. Las que pide un tercero

### Wompi — cobro de la suscripción (Colombia)

1. Entra a tu panel de Wompi → **Desarrolladores** → **Llaves**.
2. Copia la **llave pública** (`pub_test_...` en pruebas, `pub_prod_...` en producción) →
   `WOMPI_PUBLIC_KEY`.
3. Copia la **llave de eventos** → `WOMPI_EVENTS_KEY`. **No es la llave privada**: es la que
   firma los webhooks, y va en un campo aparte del panel. Si pones la privada, todas las
   firmas fallan y ningún pago se aplica.
4. Registra la URL del webhook: `https://TU-DOMINIO/api/v1/webhooks/payments/wompi`.
5. Copia la **llave privada** (`prv_test_...` / `prv_prod_...`) → `WOMPI_PRIVATE_KEY`.
   Es la tercera llave del panel y la única que autoriza a mover dinero: con ella se cobra
   sobre una tarjeta guardada sin el titular delante. **Nunca sale al frontend** —el
   navegador solo recibe la pública— y no se comparte con nadie que no despliegue el
   backend.
6. `WOMPI_API_URL`: `https://sandbox.wompi.co/v1` mientras ensayas,
   `https://production.wompi.co/v1` cuando salgas. La variable existe precisamente para que
   el ensayo con el reloj adelantado no toque dinero real.

**Por qué Wompi es la pasarela del cobro recurrente.** De las tres, es la que expone
*fuentes de pago* (`payment_sources`) reutilizables en Colombia: el navegador cambia la
tarjeta por un token de un solo uso contra `/tokens/cards` con la llave pública, el servidor
lo convierte en una fuente de pago con la privada, y a partir de ahí cobra cada periodo sin
que el comercio tenga que hacer nada. El número de la tarjeta no toca nuestra
infraestructura en ningún momento.

MercadoPago y Stripe siguen sirviendo para el pago manual por checkout: el comercio entra y
paga cada periodo. Es peor experiencia, pero es honesto —lo que no se puede hacer es
prometer cobro automático sobre una pasarela que no lo soporta, porque el comercio deja de
vigilar su factura y la suscripción se le cae.

**Para ensayar la cobranza sin pasarela**, pon `BILLING_RECURRING_GATEWAY=MOCK`: el
resultado del cobro lo decide el token de la tarjeta (uno que contenga `DECLINE` se rechaza
siempre), así que la secuencia completa —tres reintentos, gracia, degradación y suspensión—
se puede recorrer en segundos adelantando el reloj desde
`POST /platform/billing/run-engine` con `as_of`. Ese parámetro está prohibido en producción:
adelantar el reloj allí cobraría periodos que todavía no han transcurrido.

### MercadoPago — alternativa de cobro

1. developers.mercadopago.com → **Tus integraciones** → tu aplicación → **Credenciales de
   producción**.
2. **Access token** → `MERCADOPAGO_ACCESS_TOKEN`.
3. En **Webhooks**, registra `https://TU-DOMINIO/api/v1/webhooks/payments/mercadopago` y
   copia la clave secreta de la notificación → `MERCADOPAGO_WEBHOOK_SECRET`.

### Stripe — cobro internacional

1. Dashboard → **Developers** → **API keys** → *Secret key* (`sk_live_...`) →
   `STRIPE_SECRET_KEY`.
2. **Developers** → **Webhooks** → *Add endpoint*:
   `https://TU-DOMINIO/api/v1/webhooks/payments/stripe`.
3. Suscríbete a `checkout.session.completed`, `checkout.session.async_payment_failed` e
   `invoice.payment_succeeded`.
4. Copia el **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`.

### PAC de facturación electrónica

`DIAN_HTTP_URL` y `DIAN_HTTP_API_KEY` las entrega el proveedor al certificarte. El
procedimiento completo —qué preguntarle, la secuencia de conmutación y el set de pruebas de
habilitación— está en `docs/CERTIFICACION-PAC.md`.

`DIAN_PROVIDER=mock` devuelve CUDEs inventados. La API y el worker **se niegan a arrancar**
con `mock` en producción: un worker productivo en modo simulado factura al vacío y nadie se
entera hasta que llega la DIAN.

### Resend — correo transaccional

1. resend.com → **API Keys** → crear → `RESEND_API_KEY`.
2. **Verifica el dominio** desde el que se envía. Hoy el remitente está codificado como
   `notificaciones@tu-dominio.com` en
   `apps/api/src/shared/infra/notifications/providers/ResendProvider.ts`: hay que cambiarlo
   por el dominio real o ningún correo sale.

En producción, `RESEND_API_KEY` es obligatoria si `NOTIFICATION_PROVIDER=RESEND`.

### Copias de seguridad en Google Cloud

El workflow `.github/workflows/backup-database.yml` necesita, como *secrets* del repositorio
(no en `.env`): `DATABASE_URL_PRODUCTION`, `GCS_BACKUP_BUCKET` y `GCP_SA_KEY` — la clave JSON
de una cuenta de servicio con permiso de escritura sobre el bucket.

---

## 3. Antes de salir a producción

Una lista corta, toda verificable con un comando:

```bash
# 1. Ningún valor de ejemplo sobrevive
grep -nE "replace|change-me|example|your-|CAMBIAR|GENERAR_CON" .env

# 2. El rol de la API NO puede saltarse el aislamiento por comercio
psql "$ADMIN_DATABASE_URL" -tAc \
  "select rolname, rolbypassrls from pg_roles where rolname in ('pos','pos_api','api_user');"
#    pos      -> t   (dueño: migraciones y semillas)
#    pos_api  -> f   ← si esto es 't', un comercio puede leer los datos de otro
#    api_user -> f

# 3. El entorno valida tal y como lo verá producción
NODE_ENV=production node --env-file=.env --import tsx \
  -e "import('./apps/api/src/app/env.js').then(()=>console.log('OK'))"
```

Y una advertencia que cuesta una tarde encontrar: **`--env-file` no pisa una variable que ya
esté exportada en el shell**. Si tu terminal tiene `NODE_ENV=production` exportado, `pnpm dev`
arranca la API en modo producción y las validaciones estrictas se activan en desarrollo.
Compruébalo con `echo $NODE_ENV` antes de dar por buena la configuración.
