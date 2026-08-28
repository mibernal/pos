import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado autenticado para secretos que se guardan en base de datos.
 *
 * Está pensado para las credenciales del proveedor de facturación (`tenant_dian_settings`):
 * usuario y clave de acceso del PAC de cada comercio. En claro, un volcado de la base o un
 * respaldo mal guardado entrega la capacidad de emitir documentos fiscales a nombre de
 * todos los clientes a la vez.
 *
 * AES-256-GCM: cifra y autentica, de modo que un texto manipulado falla al descifrar en
 * lugar de producir basura silenciosa.
 *
 * NOTA: este módulo usa `node:crypto` y NO se exporta desde el índice del paquete, para
 * que el bundle del navegador nunca lo arrastre. Impórtalo por su ruta.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedEnvelope {
  /** Versión del formato, para poder rotar el esquema sin ambigüedad. */
  __enc: 1;
  iv: string;
  tag: string;
  data: string;
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.__enc === 1 &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.data === 'string'
  );
}

function parseKey(key: string): Buffer {
  const buffer = /^[0-9a-fA-F]{64}$/.test(key)
    ? Buffer.from(key, 'hex')
    : Buffer.from(key, 'base64');

  if (buffer.length !== KEY_BYTES) {
    throw new Error(
      `La clave de cifrado debe tener ${KEY_BYTES} bytes (64 caracteres hex o 44 en base64); recibidos ${buffer.length}.`
    );
  }

  return buffer;
}

export function encryptSecret(plaintext: string, key: string): EncryptedEnvelope {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseKey(key), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    __enc: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

export function decryptSecret(envelope: EncryptedEnvelope, key: string): string {
  const decipher = createDecipheriv(ALGORITHM, parseKey(key), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function encryptJson(value: unknown, key: string): EncryptedEnvelope {
  return encryptSecret(JSON.stringify(value), key);
}

export function decryptJson<T>(envelope: EncryptedEnvelope, key: string): T {
  return JSON.parse(decryptSecret(envelope, key)) as T;
}

/** Genera una clave nueva lista para `CREDENTIALS_ENCRYPTION_KEY`. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
