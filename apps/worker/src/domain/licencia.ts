import { createPublicKey, verify } from 'node:crypto';

/**
 * Licencia de una instalación local.
 *
 * En la nube la barrera entre pagar y no pagar es el motor de cobro. En el equipo del
 * comercio ese motor no corre —no hay pasarela ni, a veces, internet—, así que la
 * suscripción la gobierna un archivo firmado por nosotros con Ed25519. La llave privada
 * nunca sale de nuestra máquina; la instalación solo tiene la pública.
 *
 * Formato del archivo (`licencia.json`):
 *   { "payload": "<base64url de un JSON>", "firma": "<base64url de la firma Ed25519>" }
 *
 * Se firma el texto exacto del payload, no un JSON re-serializado: así no depende del orden
 * de las claves ni de los espacios.
 *
 * Honestidad sobre el alcance: quien administra el equipo puede cambiar la llave pública o
 * la base de datos. La licencia disuade y deja rastro; no es un DRM. Lo que la hace valer es
 * el contrato y el soporte, no la criptografía.
 */
export interface LicenciaPayload {
  v: 1;
  nit: string;
  comercio: string;
  plan: string;
  /** Fecha (ISO) hasta la que la licencia es válida, inclusive. */
  hasta: string;
  emitida: string;
}

export type EstadoLicencia =
  | { estado: 'VIGENTE'; payload: LicenciaPayload; diasRestantes: number }
  | { estado: 'VENCIDA'; payload: LicenciaPayload; diasVencida: number }
  | { estado: 'INVALIDA'; motivo: string };

function base64urlDecode(texto: string): Buffer {
  return Buffer.from(texto, 'base64url');
}

/** Acepta la llave pública en PEM o en base64 de un PEM (más cómodo en un `.env`). */
export function leerLlavePublica(valor: string): ReturnType<typeof createPublicKey> {
  const texto = valor.includes('BEGIN PUBLIC KEY') ? valor : Buffer.from(valor, 'base64').toString('utf8');
  return createPublicKey(texto);
}

const DIA_MS = 24 * 60 * 60 * 1000;

export function evaluarLicencia(
  contenidoArchivo: string,
  llavePublica: string,
  nitInstalado: string,
  ahora: Date = new Date()
): EstadoLicencia {
  let archivo: { payload?: unknown; firma?: unknown };
  try {
    archivo = JSON.parse(contenidoArchivo);
  } catch {
    return { estado: 'INVALIDA', motivo: 'El archivo de licencia no es JSON válido' };
  }

  if (typeof archivo.payload !== 'string' || typeof archivo.firma !== 'string') {
    return { estado: 'INVALIDA', motivo: 'Faltan los campos payload y firma' };
  }

  let firmaValida = false;
  try {
    firmaValida = verify(
      null,
      Buffer.from(archivo.payload, 'utf8'),
      leerLlavePublica(llavePublica),
      base64urlDecode(archivo.firma)
    );
  } catch {
    return { estado: 'INVALIDA', motivo: 'No se pudo verificar la firma (llave pública inválida)' };
  }

  if (!firmaValida) {
    return { estado: 'INVALIDA', motivo: 'La firma no corresponde: el archivo fue alterado o no es nuestro' };
  }

  let payload: LicenciaPayload;
  try {
    payload = JSON.parse(base64urlDecode(archivo.payload).toString('utf8')) as LicenciaPayload;
  } catch {
    return { estado: 'INVALIDA', motivo: 'El contenido firmado no es JSON válido' };
  }

  if (payload.v !== 1 || !payload.nit || !payload.plan || !payload.hasta) {
    return { estado: 'INVALIDA', motivo: 'Licencia con formato desconocido' };
  }

  // Se compara sin dígito de verificación: «900123456-7» y «900123456» son el mismo NIT.
  const normalizar = (nit: string) => (nit.split('-')[0] ?? '').replace(/[^0-9]/g, '');
  if (normalizar(payload.nit) !== normalizar(nitInstalado)) {
    return { estado: 'INVALIDA', motivo: `La licencia es del NIT ${payload.nit}, no de este comercio` };
  }

  const hasta = new Date(payload.hasta);
  if (Number.isNaN(hasta.getTime())) {
    return { estado: 'INVALIDA', motivo: 'Fecha de vencimiento inválida' };
  }
  // «Hasta el 31» incluye el 31 entero.
  const finDelDia = new Date(Date.UTC(hasta.getUTCFullYear(), hasta.getUTCMonth(), hasta.getUTCDate(), 23, 59, 59));

  if (ahora.getTime() <= finDelDia.getTime()) {
    return {
      estado: 'VIGENTE',
      payload,
      diasRestantes: Math.floor((finDelDia.getTime() - ahora.getTime()) / DIA_MS)
    };
  }

  return {
    estado: 'VENCIDA',
    payload,
    diasVencida: Math.ceil((ahora.getTime() - finDelDia.getTime()) / DIA_MS)
  };
}
