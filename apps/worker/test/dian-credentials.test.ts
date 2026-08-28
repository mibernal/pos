import { describe, expect, it, vi } from 'vitest';
import { encryptJson, generateEncryptionKey } from '@pos-dian/shared/crypto/secret-box.js';
import { resolveDianCredentials } from '../src/infra/security/dian-credentials.js';

const tenantId = '11111111-1111-4111-a111-111111111111';

describe('resolveDianCredentials', () => {
  it('descifra las credenciales cuando vienen en un sobre cifrado', () => {
    const key = generateEncryptionKey();
    const credentials = { username: 'comercio@demo.co', access_key: 'sk-secreta' };

    const resolved = resolveDianCredentials(encryptJson(credentials, key), {
      tenantId,
      isProduction: true,
      encryptionKey: key
    });

    expect(resolved).toEqual(credentials);
  });

  it('rechaza credenciales en texto plano en producción', () => {
    expect(() =>
      resolveDianCredentials(
        { username: 'u', access_key: 'k' },
        { tenantId, isProduction: true, encryptionKey: generateEncryptionKey() }
      )
    ).toThrow(/texto plano/i);
  });

  it('acepta texto plano fuera de producción, con aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const credentials = { username: 'u', access_key: 'k' };

    expect(resolveDianCredentials(credentials, { tenantId, isProduction: false })).toEqual(credentials);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('avisa si faltan la clave y las credenciales están cifradas', () => {
    const envelope = encryptJson({ username: 'u' }, generateEncryptionKey());
    expect(() =>
      resolveDianCredentials(envelope, { tenantId, isProduction: true })
    ).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
  });
});
