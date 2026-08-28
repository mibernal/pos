import { describe, expect, it } from 'vitest';
import {
  decryptJson,
  decryptSecret,
  encryptJson,
  encryptSecret,
  generateEncryptionKey,
  isEncryptedEnvelope
} from '../src/crypto/secret-box.js';

const key = generateEncryptionKey();

describe('secret-box', () => {
  it('cifra y descifra una cadena', () => {
    const envelope = encryptSecret('clave-del-pac', key);
    expect(envelope.data).not.toContain('clave-del-pac');
    expect(decryptSecret(envelope, key)).toBe('clave-del-pac');
  });

  it('cifra y descifra un objeto de credenciales', () => {
    const credentials = { username: 'comercio@demo.co', access_key: 'sk-1234567890' };
    const envelope = encryptJson(credentials, key);
    expect(JSON.stringify(envelope)).not.toContain('sk-1234567890');
    expect(decryptJson(envelope, key)).toEqual(credentials);
  });

  it('reconoce un sobre cifrado y descarta lo que no lo es', () => {
    expect(isEncryptedEnvelope(encryptSecret('x', key))).toBe(true);
    expect(isEncryptedEnvelope({ username: 'u', access_key: 'k' })).toBe(false);
    expect(isEncryptedEnvelope(null)).toBe(false);
  });

  it('falla si el texto cifrado fue manipulado', () => {
    const envelope = encryptSecret('clave-del-pac', key);
    const tampered = { ...envelope, data: Buffer.from('otro-valor').toString('base64') };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('falla con una clave distinta', () => {
    const envelope = encryptSecret('clave-del-pac', key);
    expect(() => decryptSecret(envelope, generateEncryptionKey())).toThrow();
  });

  it('rechaza una clave de tamaño incorrecto', () => {
    expect(() => encryptSecret('x', 'demasiado-corta')).toThrow(/32 bytes/);
  });
});
