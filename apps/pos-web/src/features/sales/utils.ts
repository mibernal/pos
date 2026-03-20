import { ApiClientError, type SalesListItem, type TenantTaxMode } from '../../lib/api';

export function shouldQueueSaleAsPending(error: unknown): boolean {
  if (error instanceof ApiClientError) {
    if (error.isNetworkError) {
      return true;
    }

    if (!error.status) {
      return true;
    }

    return error.status >= 500 || error.status === 408 || error.status === 429;
  }

  return false;
}

export function inferTaxModeFromSale(sale: SalesListItem): TenantTaxMode | null {
  if (sale.tax_lines_json.some((line) => line.category === 'INC')) {
    return 'INC_RESTAURANT';
  }

  if (sale.tax_lines_json.length > 0) {
    return 'IVA';
  }

  return null;
}

export function parseVisibleMoneyToCents(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed * 100));
}

export function parseRawCents(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

export function formatEditableMoneyFromCents(valueCents: number): string {
  const amount = valueCents / 100;
  if (Number.isInteger(amount)) {
    return String(amount);
  }

  return amount.toFixed(2).replace(/\.?0+$/, '');
}

export function getCheckoutErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return 'Tu sesión expiró. Inicia sesión de nuevo para continuar cobrando.';
    }

    const normalizedMessage = error.message.toLowerCase();
    if (
      error.status === 409 &&
      (normalizedMessage.includes('caja') || normalizedMessage.includes('sesión de caja'))
    ) {
      return 'La caja está cerrada. Abre una nueva sesión antes de registrar más ventas.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'No fue posible registrar la venta';
}
