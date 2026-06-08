import { describe, expect, it } from 'vitest';
import { buildTicketHtml } from '../src/lib/ticket-printer';
import { formatMoneyFromCents } from '../src/lib/format';

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('ticket printer', () => {
  it('builds a printable ticket with commercial, fiscal and branch data', () => {
    const html = buildTicketHtml({
      template: {
        businessName: 'Carnes Centro SAS',
        nit: '900123123-7',
        address: 'Calle 10 # 20-30',
        phone: '6011234567',
        footerMessage: 'Gracias por preferirnos',
        logoUrl: '',
        printerWidth: '80mm'
      },
      branchName: 'Sucursal Norte',
      branchAddress: 'Cra 15 # 40-20',
      saleNumber: 42,
      createdAt: '2026-03-07T14:15:00.000Z',
      saleStatus: 'COMPLETED',
      items: [
        {
          name: 'Bistec premium',
          qty: 2,
          priceCents: 15000,
          lineTotalCents: 30000
        }
      ],
      subtotalCents: 30000,
      discountCents: 1500,
      totalCents: 28500,
      payments: [{ method: 'CARD', amountCents: 28500 }],
      taxMode: 'IVA',
      dianStatus: 'ACCEPTED',
      cude: 'CUDE-ABC-123',
      voidReason: null,
      voidedAt: null
    });

    const normalized = normalizeText(html);

    expect(normalized).toContain('Carnes Centro SAS');
    expect(normalized).toContain('NIT:</strong> 900123123-7');
    expect(normalized).toContain('Sucursal:</strong> Sucursal Norte');
    expect(normalized).toContain('Tel:</strong> 6011234567');
    expect(normalized).toContain('Número de venta');
    expect(normalized).toContain('#42');
    expect(normalized).toContain('Incluye IVA');
    expect(normalized).toContain('Estado DIAN');
    expect(normalized).toContain('ACCEPTED');
    expect(normalized).toContain('CUDE-ABC-123');
    expect(normalized).toContain('Bistec premium');
    expect(normalized).toContain(normalizeText(formatMoneyFromCents(28500)));
    expect(normalized).toContain('Gracias por preferirnos');
  });

  it('includes void state and reason when the sale was annulled', () => {
    const html = buildTicketHtml({
      template: {
        businessName: 'Restaurante Demo',
        nit: '901234567-8',
        address: 'Calle 1 # 2-3',
        phone: '',
        footerMessage: '',
        logoUrl: '',
        printerWidth: '80mm'
      },
      branchName: 'Sucursal Centro',
      saleNumber: 99,
      createdAt: '2026-03-07T16:00:00.000Z',
      saleStatus: 'VOID',
      items: [
        {
          name: 'Menú ejecutivo',
          qty: 1,
          priceCents: 18000,
          lineTotalCents: 18000
        }
      ],
      subtotalCents: 18000,
      discountCents: 0,
      totalCents: 18000,
      payments: [{ method: 'CASH', amountCents: 18000 }],
      taxMode: 'INC_RESTAURANT',
      dianStatus: 'PENDING',
      cude: null,
      voidReason: 'Cliente canceló el pedido',
      voidedAt: '2026-03-07T16:05:00.000Z'
    });

    const normalized = normalizeText(html);

    expect(normalized).toContain('VENTA ANULADA');
    expect(normalized).toContain('Estado venta');
    expect(normalized).toContain('VOID');
    expect(normalized).toContain('Motivo');
    expect(normalized).toContain('Cliente canceló el pedido');
    expect(normalized).toContain('Incluye INC');
  });
});
