#!/usr/bin/env node
/**
 * Emite licencias para instalaciones locales. Se usa SOLO en el equipo de quien vende.
 *
 *   node onprem/licencias/firmar-licencia.mjs generar-llaves
 *       Crea privada.pem (NO va al repo, NO va al cliente) y publica.pem (va en cada paquete).
 *       Hazlo una sola vez. Si pierdes privada.pem no podrás renovar licencias de los
 *       paquetes ya instalados; si se filtra, cualquiera puede emitirlas. Guárdala en un
 *       gestor de contraseñas o en una USB cifrada, con copia.
 *
 *   node onprem/licencias/firmar-licencia.mjs emitir --nit 900123456 --comercio "La Catorce" \
 *        --plan PRO --hasta 2027-10-31
 *       Escribe emitidas/<nit>-<hasta>.json. Ese archivo se copia al comercio y se instala con
 *       scripts/instalar-licencia.sh.
 *
 *   node onprem/licencias/firmar-licencia.mjs ver <archivo.json>
 *       Muestra qué dice una licencia y si la firma es válida con publica.pem.
 *
 * Sin dependencias: solo node:crypto (Ed25519).
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const PRIVADA = process.env.LICENCIA_LLAVE_PRIVADA ?? join(DIR, 'privada.pem');
const PUBLICA = join(DIR, 'publica.pem');
const PLANES = ['STARTER', 'PRO', 'ENTERPRISE'];

function args(lista) {
  const r = {};
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].startsWith('--')) r[lista[i].slice(2)] = lista[i + 1], i++;
  }
  return r;
}

function salir(msg) { console.error(`✗ ${msg}`); process.exit(1); }

const [, , comando, ...resto] = process.argv;

if (comando === 'generar-llaves') {
  if (existsSync(PRIVADA)) salir(`Ya existe ${PRIVADA}. No la sobrescribo: invalidaría todas las licencias emitidas.`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(PRIVADA, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  chmodSync(PRIVADA, 0o600);
  writeFileSync(PUBLICA, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`✓ ${PRIVADA}  ← guárdala fuera del repo, con copia`);
  console.log(`✓ ${PUBLICA}  ← esta sí va al repo y a cada paquete`);
} else if (comando === 'emitir') {
  const a = args(resto);
  if (!a.nit || !a.hasta) salir('Uso: emitir --nit <nit> --comercio "<nombre>" --plan <PRO> --hasta <AAAA-MM-DD>');
  const plan = (a.plan ?? 'PRO').toUpperCase();
  if (!PLANES.includes(plan)) salir(`Plan desconocido. Opciones: ${PLANES.join(', ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.hasta) || Number.isNaN(new Date(a.hasta).getTime())) salir('--hasta debe ser AAAA-MM-DD');
  if (!existsSync(PRIVADA)) salir(`No encuentro ${PRIVADA}. ¿Ejecutaste generar-llaves?`);

  const payload = {
    v: 1,
    nit: String(a.nit).trim(),
    comercio: a.comercio ?? '',
    plan,
    hasta: a.hasta,
    emitida: new Date().toISOString().slice(0, 10)
  };
  const texto = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = sign(null, Buffer.from(texto, 'utf8'), createPrivateKey(readFileSync(PRIVADA))).toString('base64url');

  const salida = join(DIR, 'emitidas');
  mkdirSync(salida, { recursive: true });
  const archivo = join(salida, `${payload.nit.split('-')[0]}-${payload.hasta}.json`);
  writeFileSync(archivo, JSON.stringify({ payload: texto, firma }, null, 2) + '\n');
  console.log(`✓ ${archivo}`);
  console.log(`  ${payload.comercio} · NIT ${payload.nit} · ${plan} · hasta ${payload.hasta}`);
} else if (comando === 'ver') {
  const archivo = resto[0];
  if (!archivo) salir('Uso: ver <licencia.json>');
  const { payload, firma } = JSON.parse(readFileSync(archivo, 'utf8'));
  const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  console.log(datos);
  if (existsSync(PUBLICA)) {
    const ok = verify(null, Buffer.from(payload, 'utf8'), createPublicKey(readFileSync(PUBLICA)), Buffer.from(firma, 'base64url'));
    console.log(ok ? '✓ Firma válida' : '✗ Firma NO válida');
  }
} else {
  console.log('Comandos: generar-llaves | emitir --nit … --plan … --hasta … | ver <archivo>');
}
