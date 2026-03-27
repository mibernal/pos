export function formatMoneyFromCents(valueCents: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(valueCents / 100);
}

export function pesosToCents(pesos: number): number {
  return Math.round(pesos * 100);
}

export function centsToPesos(cents: number): number {
  return Math.round(cents / 100);
}

export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function statusClassName(
  status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | null | undefined
): string {
  if (!status) {
    return 'tag tag-muted';
  }

  if (status === 'ACCEPTED') {
    return 'tag tag-success';
  }

  if (status === 'REJECTED') {
    return 'tag tag-danger';
  }

  if (status === 'SENT') {
    return 'tag tag-info';
  }

  return 'tag tag-warning';
}

export function dianStatusLabel(
  status: 'PENDING' | 'SENT' | 'ACCEPTED' | 'REJECTED' | null | undefined
): string {
  if (!status || status === 'PENDING') return 'Pendiente';
  if (status === 'SENT') return 'Enviado';
  if (status === 'ACCEPTED') return 'Aceptado DIAN';
  if (status === 'REJECTED') return 'Rechazado DIAN';
  return status;
}
