import { describe, it, expect } from 'vitest';
import { LedgerCrypto } from '../ledger-utils.js';

describe('LedgerCrypto - Immutable Hash Chain Validations', () => {
  it('Should generate consistent hash for same payload regardless of key order', () => {
    const payloadA = { tenantId: 't1', amountCents: 100, sequenceNumber: 1n, previousHash: '0x000' };
    const payloadB = { previousHash: '0x000', tenantId: 't1', sequenceNumber: 1n, amountCents: 100 };

    const hashA = LedgerCrypto.calculateHash(payloadA);
    const hashB = LedgerCrypto.calculateHash(payloadB);

    expect(hashA).toBe(hashB);
  });

  it('Should generate different hashes for different payloads', () => {
    const payloadA = { tenantId: 't1', amountCents: 100, sequenceNumber: 1n, previousHash: '0x000' };
    const payloadB = { tenantId: 't1', amountCents: 200, sequenceNumber: 1n, previousHash: '0x000' };

    const hashA = LedgerCrypto.calculateHash(payloadA);
    const hashB = LedgerCrypto.calculateHash(payloadB);

    expect(hashA).not.toBe(hashB);
  });

  it('Should verify a valid chain of events', () => {
    const event1 = { tenantId: 't1', amount: 100, sequenceNumber: 1n, previousHash: LedgerCrypto.GENESIS_HASH, hash: '' };
    event1.hash = LedgerCrypto.calculateHash(event1);

    const event2 = { tenantId: 't1', amount: 200, sequenceNumber: 2n, previousHash: event1.hash, hash: '' };
    event2.hash = LedgerCrypto.calculateHash(event2);

    const event3 = { tenantId: 't1', amount: -50, sequenceNumber: 3n, previousHash: event2.hash, hash: '' };
    event3.hash = LedgerCrypto.calculateHash(event3);

    const isValid = LedgerCrypto.verifyChain([event1, event2, event3]);
    expect(isValid).toBe(true);
  });

  it('Should reject a tampered chain where an intermediate value was modified', () => {
    const event1 = { tenantId: 't1', amount: 100, sequenceNumber: 1n, previousHash: LedgerCrypto.GENESIS_HASH, hash: '' };
    event1.hash = LedgerCrypto.calculateHash(event1);

    const event2 = { tenantId: 't1', amount: 200, sequenceNumber: 2n, previousHash: event1.hash, hash: '' };
    event2.hash = LedgerCrypto.calculateHash(event2);

    const event3 = { tenantId: 't1', amount: -50, sequenceNumber: 3n, previousHash: event2.hash, hash: '' };
    event3.hash = LedgerCrypto.calculateHash(event3);

    // Tampering event 2's amount without re-hashing
    event2.amount = 9999;

    const isValid = LedgerCrypto.verifyChain([event1, event2, event3]);
    expect(isValid).toBe(false); // Verify will fail on event2 because expectedHash != event2.hash
  });

  it('Should reject a chain where the link (previousHash) is broken', () => {
    const event1 = { tenantId: 't1', amount: 100, sequenceNumber: 1n, previousHash: LedgerCrypto.GENESIS_HASH, hash: '' };
    event1.hash = LedgerCrypto.calculateHash(event1);

    const event2 = { tenantId: 't1', amount: 200, sequenceNumber: 2n, previousHash: 'FAKE_HASH_INJECTED', hash: '' };
    event2.hash = LedgerCrypto.calculateHash(event2);

    const isValid = LedgerCrypto.verifyChain([event1, event2]);
    expect(isValid).toBe(false);
  });
});
