import { createHash } from 'node:crypto';

/**
 * Utilidades para la generación del Ledger Inmutable.
 * Implementa un mecanismo criptográfico de hash chaining para prevenir mutaciones.
 */

interface HashPayload {
  tenantId: string;
  sequenceNumber: string | bigint;
  previousHash: string;
  [key: string]: string | number | boolean | null | bigint;
}

export class LedgerCrypto {
  /**
   * Semilla génesis inyectada en el primer evento de cada Tenant/Entidad 
   * para prevenir que la cadena inicie en vacío.
   */
  static readonly GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

  /**
   * Calcula el hash criptográfico SHA-256 para un registro del ledger.
   * Ordena las llaves alfabéticamente para asegurar un hash determinista.
   */
  static calculateHash(payload: HashPayload): string {
    const keys = Object.keys(payload).sort();
    const orderedPayload: Record<string, string> = {};

    for (const key of keys) {
      const value = payload[key];
      // Convertimos todo a string. Si es null o undefined, lo representamos como vacio
      orderedPayload[key] = value === null || value === undefined ? '' : String(value);
    }

    const payloadString = JSON.stringify(orderedPayload);
    
    return createHash('sha256')
      .update(payloadString)
      .digest('hex');
  }

  /**
   * Verifica que la cadena de hashes sea válida
   * Lanza un error si hay una manipulación.
   */
  static verifyChain(events: HashPayload[]): boolean {
    if (events.length === 0) return true;

    // Asumimos que events viene ordenado cronológicamente por sequenceNumber
    for (let i = 1; i < events.length; i++) {
      const current = events[i] as HashPayload & { hash?: string };
      const previous = events[i - 1] as HashPayload & { hash?: string };

      // 1. Verificamos que el previousHash apunte correctamente
      if (current.previousHash !== previous.hash) {
        return false;
      }

      // 2. Verificamos que el hash guardado sea el correcto matemáticamente
      const expectedHash = this.calculateHash(current);
      if (current.hash && current.hash !== expectedHash) {
        return false;
      }
    }

    return true;
  }
}
