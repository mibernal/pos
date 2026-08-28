/**
 * Cifra un objeto de credenciales para `tenant_dian_settings.credentials`.
 *
 *   pnpm --filter @pos-dian/worker encrypt-credentials '{"username":"...","access_key":"..."}'
 *
 * Sin argumentos, genera una clave nueva para CREDENTIALS_ENCRYPTION_KEY.
 */
import { encryptJson, generateEncryptionKey } from '@pos-dian/shared/crypto/secret-box.js';

const input = process.argv[2];

if (!input) {
  console.info('Clave nueva para CREDENTIALS_ENCRYPTION_KEY:\n');
  console.info(generateEncryptionKey());
  console.info('\nGuárdala en el gestor de secretos. Sin ella no se pueden leer las credenciales cifradas.');
  process.exit(0);
}

const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
if (!key) {
  console.error('Falta CREDENTIALS_ENCRYPTION_KEY en el entorno.');
  process.exit(1);
}

const credentials = JSON.parse(input) as unknown;
console.info(JSON.stringify(encryptJson(credentials, key)));
