import type { TicketPrintInput, TicketPrintPayment } from './types';

export function formatDateTimeParts(value: string): { date: string; time: string } {
  const date = new Date(value);

  return {
    date: date.toLocaleDateString('es-CO'),
    time: date.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    })
  };
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function paymentMethodLabel(method: TicketPrintPayment['method']): string {
  if (method === 'CASH') {
    return 'Efectivo';
  }
  if (method === 'CARD') {
    return 'Tarjeta';
  }
  return 'Transferencia';
}

export function taxModeLabel(taxMode: TicketPrintInput['taxMode']): string | null {
  if (!taxMode) {
    return null;
  }

  return taxMode === 'INC_RESTAURANT' ? 'Incluye INC' : 'Incluye IVA';
}

export function formatStatusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function extractTicketPayments(paymentJson: unknown): TicketPrintPayment[] {
  if (!paymentJson || typeof paymentJson !== 'object') {
    return [];
  }

  const rawPayments = (paymentJson as { payments?: unknown }).payments;
  if (!Array.isArray(rawPayments)) {
    return [];
  }

  return rawPayments
    .map((payment) => {
      if (!payment || typeof payment !== 'object') {
        return null;
      }

      const method = (payment as { method?: unknown }).method;
      const amount = (payment as { amount_cents?: unknown }).amount_cents;

      if (
        (method !== 'CASH' && method !== 'CARD' && method !== 'TRANSFER') ||
        typeof amount !== 'number' ||
        !Number.isFinite(amount)
      ) {
        return null;
      }

      return {
        method,
        amountCents: Math.round(amount)
      } satisfies TicketPrintPayment;
    })
    .filter((payment): payment is TicketPrintPayment => payment !== null);
}
