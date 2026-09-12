# Instalación local (on-premise) — guía de operación

Para los primeros comercios que piden «el programa sin internet». Esta guía es para quien
instala y da soporte, no para el comercio. El código está en `onprem/`; el porqué de cada
decisión, en `docs/ROADMAP-PRODUCCION.md` («Instalación local»).

---

## 0. Antes de vender: ¿de verdad lo necesita?

La pregunta que decide todo: **¿el cliente quiere que sus datos no salgan del local, o
simplemente no confía en su internet?**

| Si el cliente dice… | Ofrécele | Por qué |
|---|---|---|
| «Se me cae el internet» | **La nube**, como está hoy | La PWA ya vende sin conexión: guarda las ventas en la tablet y sincroniza al volver. Cero hardware, cero visitas. |
| «Aquí no hay internet estable nunca» / «Quiero los datos en mi local» / «Tengo varias cajas y no pueden depender de internet entre ellas» | **Instalación local** (esta guía) | Las cajas, mesas y cocina hablan con un equipo dentro del local. Internet solo hace falta para emitir a la DIAN, y puede llegar tarde. |

La instalación local cuesta más que la nube: hay equipo, visita y soporte en sitio. Cóbrala
así (setup único + mensualidad igual o mayor a la del SaaS).

## 1. Qué sigue necesitando internet (y qué pasa sin él)

| Función | Sin internet | Notas |
|---|---|---|
| Vender, cobrar, abrir/cerrar caja, mesas, cocina, inventario, informes | **Funciona** | Todo corre en el mini-PC. |
| Emitir a la DIAN (factura / documento equivalente POS / notas) | **Se encola** | El outbox guarda cada documento y lo emite al volver la conexión, en orden y sin duplicar. `estado.sh` muestra cuántos hay y de hace cuánto. |
| Licencia | **Funciona** | Es un archivo firmado; no consulta ningún servidor. |
| Actualizaciones | Por USB | `actualizar.sh` con el paquete nuevo. |
| Soporte remoto | No | Opcional: túnel saliente (Tailscale/Cloudflare) cuando haya internet. |
| Correos (bienvenida, alertas) | Se omiten | `NOTIFICATION_PROVIDER=NONE`. |

**Lo fiscal es una decisión tuya, no del software.** La Res. DIAN 000165 de 2023 permite,
ante inconvenientes tecnológicos (art. 37), expedir el documento en físico (arts. 10 y 21) y
transmitirlo después. Antes de vender, define y deja en el contrato: cuántas horas/días puede
facturar el comercio sin transmitir antes de que sea un problema, quién vigila esa cola
(`estado.sh` avisa a partir de 24 h) y cómo se documenta la contingencia. Confirma el plazo
exacto de transmisión del art. 37 vigente.

## 2. Hardware recomendado

- **Mini-PC** Intel N100/N150 o Ryzen equivalente, **16 GB RAM**, **SSD NVMe 512 GB**, red
  por cable. Sobra para varias cajas, KDS y meseros.
- **UPS** (500–850 VA). No es opcional: un apagón a media escritura es la forma más común
  de perder datos en un POS local. Postgres está configurado para no corromperse, pero la
  UPS evita perder minutos de trabajo y daños al disco.
- **IP fija**: reserva por DHCP en el router del local (por la MAC del mini-PC). Si la IP
  cambia, las tablets dejan de encontrar el servidor (ver §6.5).
- **USB o disco externo** para la copia externa de respaldos (§6.2).
- Tablets/PC de caja: cualquier navegador Chrome/Edge/Safari reciente.

## 3. Una sola vez: llaves de licencia

En tu equipo, en la raíz del repo:

```bash
node onprem/licencias/firmar-licencia.mjs generar-llaves
git add onprem/licencias/publica.pem   # la pública SÍ va al repo
```

`onprem/licencias/privada.pem` **no** va al repo (está en `.gitignore`) ni al cliente.
Guárdala en tu gestor de contraseñas con copia: sin ella no puedes renovar licencias; si se
filtra, cualquiera puede emitirlas.

## 4. Preparar el paquete y el equipo (en tu oficina, con internet)

### 4.1 Construir el paquete

Requiere Docker Desktop con buildx. En la raíz del repo, con los cambios confirmados:

```bash
./onprem/scripts/construir-paquete.sh                 # versión = AAAA.MM.DD-commit
./onprem/scripts/construir-paquete.sh --con-docker    # además trae Docker para Ubuntu 24.04
```

Sale `onprem/paquete/pos-dian-<versión>.tar.gz` (~600 MB–1 GB). Las imágenes se construyen
para `linux/amd64` aunque tu Mac sea Apple Silicon (tarda más la primera vez).

### 4.2 Emitir la licencia del comercio

```bash
node onprem/licencias/firmar-licencia.mjs emitir --nit 900123456 --comercio "La Catorce" --plan PRO --hasta 2027-10-31
```

Sale `onprem/licencias/emitidas/900123456-2027-10-31.json`. La vigencia es la del contrato
(mensual, trimestral o anual). Al vencer, la caja **sigue vendiendo y facturando**; se apaga
el backoffice (informes, catálogo, usuarios) hasta instalar la renovación.

### 4.3 Preparar el mini-PC

**Recomendado: prepararlo en tu oficina** y llevarlo listo. Instala **Ubuntu Server 24.04
LTS** (usuario administrador, OpenSSH activado), actualiza (`sudo apt update && sudo apt
full-upgrade`) e instala Docker (`curl -fsSL https://get.docker.com | sudo sh`). Así en el
local solo queda conectarlo.

Si toca instalar el sistema directamente en el local sin internet, usa el paquete construido
con `--con-docker`: `instalar.sh` instala Docker desde los `.deb` incluidos.

## 5. Instalar en el local

```bash
# Copia el paquete y la licencia desde la USB al mini-PC
tar xzf pos-dian-<versión>.tar.gz && cd pos-dian-<versión>
sudo ./scripts/instalar.sh                    # interactivo
#   o, con los datos preparados:  cp comercio.env.ejemplo comercio.env && nano comercio.env
#                                 sudo ./scripts/instalar.sh comercio.env && shred -u comercio.env
sudo /opt/pos-dian/scripts/instalar-licencia.sh /media/usb/900123456-2027-10-31.json
sudo /opt/pos-dian/scripts/configurar-pac.sh  # si no diste los datos del PAC al instalar
```

El instalador: verifica el paquete (SHA256), carga las imágenes, genera secretos
aleatorios en `/opt/pos-dian/.env`, crea una autoridad certificadora del local y el
certificado HTTPS, aplica migraciones, crea el rol `pos_api` sin `BYPASSRLS`, da de alta el
comercio (dueño, sede, cajas, medios de pago), arranca todo y programa respaldos.

### 5.1 Cada tablet / caja (una vez por dispositivo)

1. Abrir `http://<IP-del-mini-PC>/instalar-certificado` y seguir las instrucciones (Android,
   iPhone/iPad, Windows). **Sin este paso no hay modo offline ni impresión directa**: el
   service worker y la Web Serial API exigen HTTPS de confianza.
2. Abrir `https://<IP-del-mini-PC>/`, entrar con el usuario del dueño, elegir sede y caja.
3. En Chrome/Edge: «Instalar aplicación» para que quede como app.

### 5.2 Lista de comprobación antes de irte

- [ ] `sudo /opt/pos-dian/scripts/estado.sh` todo en verde (servicios `healthy`, licencia
      vigente, PAC configurado).
- [ ] Una venta de prueba desde cada caja; el documento DIAN pasa a `ACCEPTED` (o queda en
      cola si no hay internet, y sale al conectarlo).
- [ ] Desconectar el cable de internet del router: se sigue vendiendo desde todas las cajas.
- [ ] Apagar el mini-PC desde el botón y volver a encender: todo arranca solo en ~1 min.
- [ ] `sudo /opt/pos-dian/scripts/respaldo.sh` y `validar-respaldo.sh` terminan con ✓.
- [ ] Copia cifrada de `/opt/pos-dian/.env` guardada fuera del equipo (tu gestor de
      contraseñas). **Sin ella un respaldo no se puede restaurar.**
- [ ] Contraseña del dueño entregada; anotada la IP y el nombre del equipo en la ficha del cliente.

## 6. Operación

Todos los comandos se ejecutan en el mini-PC con `sudo`, desde `/opt/pos-dian/scripts/`.

### 6.1 Diagnóstico — `estado.sh`
Lo primero cuando el comercio llama: servicios, documentos DIAN en cola y su antigüedad,
internet, licencia, edad del último respaldo y de la última validación, disco, reloj.

### 6.2 Respaldos — `respaldo.sh`, `validar-respaldo.sh`, `restaurar.sh`
- Automático cada noche (02:30): base + imágenes de productos, 14 diarios y 8 semanales en
  `/var/backups/pos-dian`. Cada domingo se restaura el último en una base aparte para
  comprobar que sirve.
- **Copia externa**: añade al `.env` `RESPALDO_EXTERNO=/media/respaldo` y
  `RESPALDO_CLAVE=<frase larga>`, con un USB/disco montado ahí (o un NAS). La copia va
  cifrada e incluye el `.env`. Un respaldo en el mismo disco no sobrevive a que el disco muera.
- Restaurar: `restaurar.sh <archivo.dump>` o `restaurar.sh <copia.tar.enc>`. Pide escribir
  `RESTAURAR` y antes respalda lo que hay.

### 6.3 Actualizar — `actualizar.sh`
```bash
sudo ./actualizar.sh /media/usb/pos-dian-<nueva>.tar.gz
sudo ./actualizar.sh --revertir     # vuelve a la versión anterior y a sus datos
```
Respalda, carga imágenes, aplica migraciones y comprueba salud. Las cajas ven el aviso de
versión nueva y se recargan solas cuando no hay una venta en curso. **Revertir restaura la
base de antes de actualizar**: las ventas hechas entre medias se pierden, así que se revierte
el mismo día o no se revierte.

### 6.4 Licencia — `instalar-licencia.sh`
Emite la renovación en tu equipo (§4.2) y cópiala por USB, correo o WhatsApp:
`sudo ./instalar-licencia.sh licencia.json`.

### 6.5 Cambió la IP del equipo — `certificados.sh --renovar`
Rehace el certificado con las IP actuales (con la misma CA: las tablets no hay que tocarlas)
y actualiza los orígenes permitidos de la API. Mejor evitarlo con la reserva DHCP.

### 6.6 El dueño olvidó la contraseña — `restablecer-clave.sh`
Pone una contraseña nueva al dueño (o genera una) y cierra todas sus sesiones abiertas.

### 6.7 El mini-PC murió (recuperación)
1. Equipo nuevo con Ubuntu + Docker (§4.3).
2. `sudo mkdir -p /opt/pos-dian` y copiar ahí el `.env` guardado (o el de la copia externa).
3. `sudo ./scripts/instalar.sh` desde el paquete de la **misma versión** (con `.env` presente
   no crea un comercio nuevo).
4. `sudo /opt/pos-dian/scripts/restaurar.sh <último respaldo>` y reinstalar la licencia.
5. Las tablets: hay CA nueva salvo que se recupere `/opt/pos-dian/certs/` — repetir §5.1.

## 7. Seguridad de la instalación

- Solo nginx escucha en la red (443, y 80 para redirigir y bajar el certificado raíz).
  Postgres, Redis, API y worker no publican puertos.
- La API usa `pos_api` (sin `BYPASSRLS`); el aislamiento lo impone PostgreSQL igual que en
  la nube.
- Sin autoregistro, sin panel de plataforma, sin checkout ni webhooks de pago
  (`DEPLOYMENT_MODE=onprem`).
- `/opt/pos-dian/.env`, certificados y respaldos: solo root (600/700).
- Cambia la contraseña del usuario de Ubuntu por una propia de cada cliente y desactiva el
  acceso SSH por contraseña si dejas llave.

## 8. Límites conocidos

- **La licencia disuade, no impide.** Quien administre el equipo puede cambiar la llave
  pública o la base. Lo que la hace valer es el contrato y el soporte.
- **Un comercio por instalación.** Multi-sede entre locales distintos sin internet no es
  posible: cada sede tendría su propia base. Para varias sedes, la nube.
- **Sin soporte remoto sin internet.** Cada incidencia es una visita o una llamada guiada con
  `estado.sh`.
- **Hora del equipo**: la DIAN rechaza documentos con fecha errada. Sin internet no hay NTP;
  revisa la hora en cada visita (`estado.sh` la muestra).
