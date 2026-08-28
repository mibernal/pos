import type {
  DianProvider,
  DianProviderEmitSaleInput,
  DianProviderEmitSaleResult,
} from './dian-provider.js';

interface SiigoAuthResponse {
  access_token: string;
  expires_in: number;
}

export class DianProviderSiigo implements DianProvider {
  private readonly credentials: Record<string, unknown>;
  private readonly testMode: boolean;
  private readonly baseUrl: string = 'https://api.siigo.com/v1';

  constructor(credentials: Record<string, unknown>, testMode: boolean) {
    this.credentials = credentials;
    this.testMode = testMode;
  }

  private async getAuthToken(): Promise<string> {
    const username = this.credentials.username as string;
    const accessKey = this.credentials.access_key as string;

    if (!username || !accessKey) {
      throw new Error('Siigo provider requires "username" and "access_key" in credentials');
    }

    const response = await fetch('https://api.siigo.com/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        access_key: accessKey
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Siigo Auth Failed: ${response.status} - ${errBody}`);
    }

    const data = (await response.json()) as SiigoAuthResponse;
    return data.access_token;
  }

  private mapToSiigoPayload(input: DianProviderEmitSaleInput) {
    const saleDate = new Date(input.sale.created_at).toISOString().split('T')[0];

    // In a real scenario, these IDs (taxes, payment methods, customer) 
    // must be synced from Siigo to our DB or mapped dynamically.
    // For MVP, we pass generic placeholders or read from metadata.
    
    return {
      document: {
        // ID of the electronic invoice document type in Siigo
        id: this.credentials.document_id || 1 
      },
      date: saleDate,
      customer: {
        // Consumer final generic format
        person_type: 'Person',
        id_type: '13',
        identification: '222222222222', // Consumidor Final
        name: ['Consumidor', 'Final'],
        address: {
          address: 'Conocida',
          city: {
            country_code: 'Co',
            state_code: '11',
            city_code: '11001'
          }
        }
      },
      seller: this.credentials.seller_id || 1,
      items: input.sale.items.map((item) => ({
        code: item.product_id.substring(0, 8), // Max string constraints
        description: item.product_name.substring(0, 50),
        quantity: Number(item.qty),
        price: item.base_cents / 100,
        discount: 0,
        taxes: item.tax_cents > 0 ? [
          {
            id: this.credentials.default_tax_id || 13156, // IVA 19% example
            name: item.tax_category,
            type: input.taxMode === 'IVA' ? 'IVA' : 'Impoconsumo',
            percentage: item.rate
          }
        ] : []
      })),
      payments: [
        {
          id: this.credentials.payment_method_id || 5636, // Example Payment Method ID in Siigo
          value: input.sale.total_cents / 100,
          due_date: saleDate
        }
      ]
    };
  }

  async emitSale(input: DianProviderEmitSaleInput): Promise<DianProviderEmitSaleResult> {
    try {
      const token = await this.getAuthToken();
      const siigoPayload = this.mapToSiigoPayload(input);

      const response = await fetch(`${this.baseUrl}/invoices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(siigoPayload)
      });

      const responseBody = await response.json();

      if (!response.ok) {
        return {
          status: 'REJECTED',
          cude: null,
          raw: {
            provider: 'siigo',
            statusCode: response.status,
            error: responseBody
          }
        };
      }

      // Extract CUFE/CUDE from Siigo's successful response
      const cude = responseBody.stamp?.cufe || responseBody.uuid || null;

      return {
        status: 'ACCEPTED',
        cude: cude,
        raw: {
          provider: 'siigo',
          testMode: this.testMode,
          siigoId: responseBody.id,
          payload: siigoPayload,
          response: responseBody
        }
      };

    } catch (error) {
      return {
        status: 'REJECTED',
        cude: null,
        raw: {
          provider: 'siigo',
          testMode: this.testMode,
          error: error instanceof Error ? error.message : 'Unknown network error'
        }
      };
    }
  }
}
