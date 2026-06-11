import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StripeGateway } from './stripe-gateway.js';
import { MercadoPagoGateway } from './mercadopago-gateway.js';
import { WompiGateway } from './wompi-gateway.js';
import { MockGateway } from './mock-gateway.js';

describe('Payment Gateways', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('StripeGateway', () => {
    it('should parse checkout.session.completed as APPROVED', async () => {
      const gateway = new StripeGateway();
      const payload = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            client_reference_id: 'REF_123'
          }
        }
      };
      
      const result = await gateway.parseWebhook(payload);
      expect(result.status).toBe('APPROVED');
      expect(result.reference).toBe('REF_123');
      expect(result.gatewayTransactionId).toBe('cs_test_123');
    });

    it('should parse checkout.session.async_payment_failed as DECLINED', async () => {
      const gateway = new StripeGateway();
      const payload = {
        type: 'checkout.session.async_payment_failed',
        data: {
          object: {
            id: 'cs_test_456',
            client_reference_id: 'REF_456'
          }
        }
      };
      
      const result = await gateway.parseWebhook(payload);
      expect(result.status).toBe('DECLINED');
    });
  });

  describe('WompiGateway', () => {
    it('should parse APPROVED transaction as APPROVED', async () => {
      const gateway = new WompiGateway();
      const payload = {
        data: {
          transaction: {
            id: 'TRX_1',
            reference: 'REF_W',
            status: 'APPROVED'
          }
        }
      };
      
      const result = await gateway.parseWebhook(payload);
      expect(result.status).toBe('APPROVED');
      expect(result.reference).toBe('REF_W');
    });

    it('should parse DECLINED transaction as DECLINED', async () => {
      const gateway = new WompiGateway();
      const payload = {
        data: {
          transaction: {
            id: 'TRX_2',
            reference: 'REF_W2',
            status: 'DECLINED'
          }
        }
      };
      
      const result = await gateway.parseWebhook(payload);
      expect(result.status).toBe('DECLINED');
    });

    it('should safely handle missing properties in verifyWebhookSignature', () => {
      const gateway = new WompiGateway();
      const payload = {
        signature: {
          properties: ['transaction.amount_in_cents', 'transaction.id', 'non_existent.prop'],
          checksum: 'wrong_checksum_but_we_test_no_crash'
        },
        timestamp: 123456789,
        data: {
          transaction: {
            amount_in_cents: 1000,
            id: 'ABC'
          }
        }
      };
      
      // Should not crash due to null/undefined reading
      const isValid = gateway.verifyWebhookSignature({}, JSON.stringify(payload));
      expect(isValid).toBe(false);
    });
  });

  describe('MercadoPagoGateway', () => {
    it('should fetch payment info and return APPROVED if status is approved', async () => {
      const gateway = new MercadoPagoGateway();
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'approved',
          external_reference: 'REF_MP'
        })
      });

      const payload = { data: { id: '999' } };
      const result = await gateway.parseWebhook(payload);
      
      expect(global.fetch).toHaveBeenCalledWith('https://api.mercadopago.com/v1/payments/999', expect.any(Object));
      expect(result.status).toBe('APPROVED');
      expect(result.reference).toBe('REF_MP');
      expect(result.gatewayTransactionId).toBe('999');
    });

    it('should fetch payment info and return DECLINED if status is rejected', async () => {
      const gateway = new MercadoPagoGateway();
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'rejected',
          external_reference: 'REF_MP_2'
        })
      });

      const payload = { data: { id: '888' } };
      const result = await gateway.parseWebhook(payload);
      
      expect(result.status).toBe('DECLINED');
    });

    it('should return ERROR if fetch fails', async () => {
      const gateway = new MercadoPagoGateway();
      
      global.fetch = vi.fn().mockResolvedValue({
        ok: false
      });

      const payload = { data: { id: '777' } };
      const result = await gateway.parseWebhook(payload);
      
      expect(result.status).toBe('ERROR');
    });
  });

  describe('MockGateway', () => {
    it('should return the provided status or APPROVED', async () => {
      const gateway = new MockGateway();
      const payload = { reference: 'MOCK_1', status: 'PENDING' };
      
      const result = await gateway.parseWebhook(payload);
      expect(result.status).toBe('PENDING');
      expect(result.reference).toBe('MOCK_1');
    });
  });
});
