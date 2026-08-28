# Certificación con el PAC

Guía para pasar de emitir contra un simulador a emitir facturas electrónicas reales ante la DIAN. Es el último bloqueante para facturar legalmente y **el único cuyos tiempos no dependen del código**: la parte técnica está lista, la certificación son semanas de ida y vuelta con un tercero.

Empieza esta conversación con el PAC antes de terminar cualquier otra cosa.

---

## Qué está listo y qué falta

| Pieza | Estado |
|---|---|
| Numeración autorizada (resolución, prefijo, consecutivo, vigencia) | ✅ Fase 4 |
| Consecutivo atómico, sin duplicados ni huecos | ✅ Verificado con 12 workers concurrentes |
| Aviso de rango por agotarse y resolución por vencer | ✅ Fase 4 |
| Cierre del ciclo de documentos en `SENT` (consulta + webhook + alerta) | ✅ Fase 4 |
| Domicilio entregado → venta → documento fiscal | ✅ Fase 4 |
| Credenciales del PAC cifradas en reposo | ✅ Fase 1 |
| Guarda contra el proveedor simulado en producción | ✅ Fase 1 |
| Nota crédito por anulación | ✅ Ya existía |
| **Adaptador del PAC concreto que contrates** | ⏳ Depende de cuál sea |
| **Certificación en el ambiente de pruebas del PAC** | ⏳ Depende del PAC |
| **Habilitación en producción con tenant piloto** | ⏳ Depende de la DIAN |

---

## Qué pedirle al PAC en la primera conversación

Conviene tener estas respuestas por escrito antes de firmar, porque cada una cambia el trabajo de integración:

1. **¿El adaptador HTTP genérico sirve, o hace falta uno propio?** El proyecto trae `HTTP_GENERIC`, que hace `POST` con el payload de `DianProviderEmitSaleInput` y espera `{ status, cude }`. Si el PAC usa SOAP, un esquema UBL propio o firma en el cliente, hace falta un adaptador — un archivo en `apps/worker/src/providers/`, uno o dos días de trabajo, no una reescritura.
2. **¿Ofrece consulta de estado?** Es lo que cierra el ciclo de los documentos que quedan en `SENT`. Si no la ofrece, hay que depender del webhook, y entonces el punto 3 se vuelve obligatorio.
3. **¿Envía webhook cuando la DIAN resuelve?** Si sí: ¿cómo firma la notificación, y admite una URL distinta por comercio? El endpoint está en `POST /api/v1/webhooks/dian/:tenantId/status` y valida HMAC-SHA256 sobre el cuerpo crudo con la cabecera `x-dian-signature`.
4. **¿Quién genera el CUFE/CUDE, el PAC o nosotros?** Hoy se asume que lo genera el PAC y lo devuelve. Si hay que calcularlo aquí, hace falta el certificado digital del comercio y la clave técnica de la resolución (el campo `technical_key` ya existe en `dian_resolutions`).
5. **¿Cómo se representa el INC de restaurantes?** Colombia distingue IVA e impuesto al consumo, y cada PAC lo codifica a su manera. El proyecto ya calcula ambos; hay que mapear el código.
6. **¿Cuál es el límite de peticiones y el tiempo de respuesta esperado?** Determina si `DIAN_HTTP_TIMEOUT_MS` (15 s por defecto) y el backoff del outbox son razonables.
7. **¿Qué pasa con un documento rechazado?** ¿Se puede reenviar con el mismo número, o hay que quemar el consecutivo y emitir otro? La respuesta cambia cómo se maneja `REJECTED`.
8. **Costos por documento y por comercio**, y si el ambiente de pruebas cuesta.

---

## Secuencia de conmutación

Los tres modos conviven; se avanza de uno al siguiente sin tocar código, solo configuración.

### 1. Simulador (donde está hoy)

```env
DIAN_PROVIDER=mock
```

Devuelve CUDEs inventados. **Prohibido en producción**: el arranque del worker aborta si `NODE_ENV=production` y el proveedor es `mock`. Un worker productivo en modo simulador devolvería CUDEs falsos y nadie se enteraría hasta la primera visita de la DIAN.

### 2. Ambiente de pruebas del PAC

```env
DIAN_PROVIDER=http
DIAN_HTTP_URL=https://pruebas.tu-pac.co/api/v1
DIAN_HTTP_API_KEY=<clave del ambiente de pruebas>
```

Y por comercio, en `tenant_dian_settings`:

```sql
UPDATE tenant_dian_settings SET test_mode = true WHERE tenant_id = '<piloto>';
```

Cifra las credenciales antes de cargarlas:

```bash
pnpm --filter @pos-dian/worker encrypt-credentials
```

La resolución de pruebas que da la DIAN para habilitación tiene su propio prefijo (habitualmente `SETP`) y un rango corto. Cárgala igual que una real:

```bash
curl -X POST https://api.tu-dominio.co/api/v1/dian/resolutions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "resolution_number": "18760000001",
    "resolution_date": "2026-08-01",
    "prefix": "SETP",
    "range_from": 990000000,
    "range_to": 995000000,
    "valid_from": "2026-08-01",
    "valid_until": "2028-08-01",
    "alert_threshold": 500
  }'
```

### 3. Producción, con un comercio piloto

```env
DIAN_PROVIDER=http
DIAN_HTTP_URL=https://api.tu-pac.co/v1
DIAN_HTTP_API_KEY=<clave de producción>
```

```sql
UPDATE tenant_dian_settings SET test_mode = false WHERE tenant_id = '<piloto>';
```

**Un solo comercio, con volumen controlado, durante al menos una semana.** Es el único momento en que un error se puede corregir sin afectar a todos los clientes a la vez.

---

## Set de pruebas de habilitación

La DIAN exige un conjunto de documentos aceptados en el ambiente de pruebas antes de habilitar. El número exacto lo indica el PAC; estos son los casos que conviene cubrir con la operación real del POS, no con documentos sintéticos, porque es donde aparecen las diferencias:

| # | Caso | Cómo generarlo |
|---|---|---|
| 1 | Factura con IVA 19 % | Venta de mostrador con un producto `IVA_19` |
| 2 | Factura con IVA 5 % | Producto `IVA_5` |
| 3 | Factura con producto excluido | Producto `EXCLUDED` |
| 4 | Factura con producto exento | Producto `EXEMPT` |
| 5 | Factura mixta (varias tarifas en el mismo documento) | Carrito con productos de tres categorías distintas |
| 6 | Factura con INC de restaurante | Comercio en `tax_mode = INC_RESTAURANT`, producto `INC_8` |
| 7 | Factura con descuento | Venta con `discount_cents > 0` |
| 8 | Factura con pago mixto | Efectivo + tarjeta en la misma venta |
| 9 | Nota crédito por anulación total | Anular una venta ya aceptada |
| 10 | Factura de domicilio | `POST /branches/:id/deliveries/:id/invoice` |

Después de cada uno, comprueba en la base que el ciclo cerró de verdad:

```sql
SELECT d.prefix, d.document_number, d.status, d.cude, s.total_cents
FROM dian_documents d JOIN sales s ON s.id = d.sale_id
WHERE d.tenant_id = '<piloto>'
ORDER BY d.created_at DESC LIMIT 20;
```

Lo que hay que ver: `status = 'ACCEPTED'`, `cude` no nulo, y `document_number` **consecutivo sin huecos**. Un hueco aquí es un hueco que habrá que justificar ante la DIAN.

---

## Verificaciones antes de emitir la primera factura real

- [ ] `DIAN_PROVIDER=http` y el worker arranca sin errores (con `mock` en producción aborta).
- [ ] `CREDENTIALS_ENCRYPTION_KEY` configurada y las credenciales del PAC cifradas — en producción, texto plano es un error de arranque.
- [ ] El comercio piloto tiene una resolución activa: `GET /api/v1/dian/resolutions` devuelve `health: "OK"`.
- [ ] `DIAN_WEBHOOK_SECRET` configurada y la URL registrada en el panel del PAC, si ofrece webhook.
- [ ] Los datos fiscales del comercio están completos y coinciden con el RUT: NIT, razón social, dirección.
- [ ] Una venta de prueba en el ambiente de pruebas llegó hasta `ACCEPTED` con CUDE.
- [ ] Una anulación de prueba generó su nota crédito y también llegó a `ACCEPTED`.

---

## Qué vigilar la primera semana

```sql
-- Documentos que no cierran. Debería ser una lista vacía o casi.
SELECT id, prefix, document_number, status,
       round(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600) AS horas
FROM dian_documents
WHERE status IN ('PENDING', 'SENT') AND updated_at < NOW() - INTERVAL '2 hours'
ORDER BY updated_at;

-- Rechazos: cada uno es una factura que el comercio cree emitida y no lo está.
SELECT id, prefix, document_number, provider_response_json->>'rejection_reason' AS motivo
FROM dian_documents WHERE status = 'REJECTED' ORDER BY updated_at DESC;

-- Salud de la numeración.
SELECT prefix, current_number, range_to, range_to - current_number AS quedan, valid_until
FROM dian_resolutions WHERE is_active;

-- Huecos en el consecutivo: debería devolver cero filas.
SELECT document_number + 1 AS hueco_desde
FROM dian_documents d
WHERE document_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM dian_documents n
    WHERE n.tenant_id = d.tenant_id AND n.prefix = d.prefix
      AND n.document_number = d.document_number + 1
  )
  AND document_number < (SELECT current_number FROM dian_resolutions r
                         WHERE r.tenant_id = d.tenant_id AND r.is_active LIMIT 1);
```

Las alertas también llegan solas a la bandeja de salida: `dian_resolution.alert` cuando el rango se está agotando o la resolución está por vencer, y `dian_document.unresolved` cuando un documento lleva más de `DIAN_SENT_ALERT_HOURS` (6 por defecto) sin resolverse.

---

## Escribir un adaptador nuevo

Si el PAC no encaja con `HTTP_GENERIC`:

1. Crea `apps/worker/src/providers/dian-provider-<nombre>.ts` implementando `DianProvider`: `emitSale` obligatorio, `queryStatus` opcional pero muy recomendable.
2. Regístralo en `apps/worker/src/providers/index.ts`, dentro del `switch` de `provider_name`.
3. Añade el valor al tipo `TenantDianProviderType` en `apps/api/src/shared/infra/db/schema.ts`.
4. Escribe su prueba junto a `dian-provider-http-generic.test.ts`. Cubre al menos: respuesta aceptada con CUDE, rechazo, timeout, y **aceptado sin CUDE** — que debe fallar, porque un documento aceptado sin CUDE no es verificable ante la DIAN.

El adaptador recibe `input.numbering` con el prefijo, el consecutivo, el número completo, la resolución y su vigencia. **Nunca uses `sale.sale_number` como número de factura**: es el contador interno del comercio, no la numeración que la DIAN autorizó.
