import {
  decryptJson,
  isEncryptedEnvelope
} from '@pos-dian/shared/crypto/secret-box.js';

/**
 * Resuelve las credenciales del PAC de un tenant.
 *
 * `tenant_dian_settings.credentials` guarda el usuario y la clave de acceso del proveedor
 * de facturación. En producción exigimos que estén cifradas: un volcado de la base o un
 * respaldo mal guardado no puede entregar la capacidad de emitir documentos fiscales a
 * nombre de todos los comercios a la vez.
 *
 * Fuera de producción se aceptan en claro para no entorpecer el desarrollo, con aviso.
 */
export function resolveDianCredentials(
  raw: unknown,
  options: { tenantId: string; isProduction: boolean; encryptionKey?: string }
): Record<string, unknown> {
  const { tenantId, isProduction, encryptionKey } = options;

  if (isEncryptedEnvelope(raw)) {
    if (!encryptionKey) {
      throw new Error(
        'Las credenciales DIAN están cifradas pero falta CREDENTIALS_ENCRYPTION_KEY en el entorno.'
      );
    }
    return decryptJson<Record<string, unknown>>(raw, encryptionKey);
  }

  if (isProduction) {
    throw new Error(
      `Las credenciales DIAN del tenant ${tenantId} están en texto plano. ` +
        'Cífralas con `pnpm --filter @pos-dian/worker encrypt-credentials` antes de operar en producción.'
    );
  }

  console.warn(
    `[dian] Credenciales del tenant ${tenantId} sin cifrar. Aceptado solo fuera de producción.`
  );

  return (raw ?? {}) as Record<string, unknown>;
}
