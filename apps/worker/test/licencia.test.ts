import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { evaluarLicencia } from '../src/domain/licencia.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const llavePublica = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function firmar(payload: object, llave = privateKey): string {
  const texto = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const firma = sign(null, Buffer.from(texto, 'utf8'), llave).toString('base64url');
  return JSON.stringify({ payload: texto, firma });
}

const base = { v: 1, nit: '900123456-7', comercio: 'Panadería La 14', plan: 'PRO', hasta: '2027-01-31', emitida: '2026-10-21' };
const enero = new Date('2027-01-15T12:00:00Z');

describe('licencia on-premise', () => {
  it('vigente hasta el final del día de vencimiento', () => {
    const r = evaluarLicencia(firmar(base), llavePublica, '900123456', new Date('2027-01-31T23:00:00Z'));
    expect(r.estado).toBe('VIGENTE');
  });

  it('vencida al día siguiente', () => {
    const r = evaluarLicencia(firmar(base), llavePublica, '900123456', new Date('2027-02-01T05:00:00Z'));
    expect(r.estado).toBe('VENCIDA');
  });

  it('acepta la llave en base64 de un PEM', () => {
    const b64 = Buffer.from(llavePublica).toString('base64');
    expect(evaluarLicencia(firmar(base), b64, '900123456-7', enero).estado).toBe('VIGENTE');
  });

  it('rechaza un payload alterado', () => {
    const archivo = JSON.parse(firmar(base));
    archivo.payload = Buffer.from(JSON.stringify({ ...base, hasta: '2099-12-31' })).toString('base64url');
    const r = evaluarLicencia(JSON.stringify(archivo), llavePublica, '900123456', enero);
    expect(r.estado).toBe('INVALIDA');
  });

  it('rechaza una licencia firmada con otra llave', () => {
    const otra = generateKeyPairSync('ed25519').privateKey;
    expect(evaluarLicencia(firmar(base, otra), llavePublica, '900123456', enero).estado).toBe('INVALIDA');
  });

  it('rechaza la licencia de otro NIT', () => {
    expect(evaluarLicencia(firmar(base), llavePublica, '800999888', enero).estado).toBe('INVALIDA');
  });

  it('no revienta con basura', () => {
    expect(evaluarLicencia('no es json', llavePublica, '900123456', enero).estado).toBe('INVALIDA');
    expect(evaluarLicencia('{}', llavePublica, '900123456', enero).estado).toBe('INVALIDA');
  });
});
