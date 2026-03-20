import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult
} from './dian-provider.js';

export class DianProviderMock implements DianProvider {
  async emitSale(input: DianProviderEmitSaleInput): Promise<DianProviderEmitSaleResult> {
    const hash = Buffer.from(input.idempotency_key).toString('hex').slice(0, 24);

    return {
      cude: `CUDE-${hash}`,
      status: 'ACCEPTED',
      raw: {
        provider: 'mock',
        saleId: input.sale_id,
        taxMode: input.taxMode,
        tax_total_cents: input.sale.tax_total_cents,
        tax_lines: input.sale.tax_lines,
        itemTaxes: input.sale.items.map((item) => ({
          product_id: item.product_id,
          tax_category: item.tax_category,
          category: item.category,
          base_cents: item.base_cents,
          tax_cents: item.tax_cents,
          rate: item.rate
        })),
        tenantNit: input.tenant.nit,
        branchName: input.branch.name,
        totalCents: input.sale.total_cents,
        acceptedAt: new Date().toISOString()
      }
    };
  }
}
