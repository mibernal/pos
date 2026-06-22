export interface TicketTemplateConfig {
  businessName: string;
  nit: string;
  address: string;
  phone: string;
  footerMessage: string;
  logoUrl: string;
  printerWidth: '58mm' | '80mm';
  businessType?: string;
  customBusinessType?: string;
}

interface TicketTemplateFallback {
  branchName?: string;
  branchAddress?: string;
}

const TEMPLATE_KEY_PREFIX = 'pos-dian:web:ticket-template';

function getStorageKey(tenantId: string): string {
  return `${TEMPLATE_KEY_PREFIX}:${tenantId}`;
}

function normalizeText(value: string): string {
  return value.trim();
}

function buildDefaultTemplate(fallback?: TicketTemplateFallback): TicketTemplateConfig {
  return {
    businessName: fallback?.branchName?.trim() || 'POS DIAN',
    nit: 'N/A',
    address: fallback?.branchAddress?.trim() || 'Dirección no configurada',
    phone: '',
    footerMessage: '',
    logoUrl: '',
    printerWidth: '80mm',
    businessType: 'OTHER'
  };
}

export function readTicketTemplate(
  tenantId: string,
  fallback?: TicketTemplateFallback
): TicketTemplateConfig {
  const defaultTemplate = buildDefaultTemplate(fallback);

  if (typeof window === 'undefined') {
    return defaultTemplate;
  }

  const raw = window.localStorage.getItem(getStorageKey(tenantId));
  if (!raw) {
    return defaultTemplate;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TicketTemplateConfig>;
    return {
      businessName: normalizeText(parsed.businessName ?? defaultTemplate.businessName),
      nit: normalizeText(parsed.nit ?? defaultTemplate.nit),
      address: normalizeText(parsed.address ?? defaultTemplate.address),
      phone: normalizeText(parsed.phone ?? defaultTemplate.phone),
      footerMessage: normalizeText(parsed.footerMessage ?? defaultTemplate.footerMessage),
      logoUrl: normalizeText(parsed.logoUrl ?? defaultTemplate.logoUrl),
      printerWidth: parsed.printerWidth === '58mm' ? '58mm' : '80mm',
      businessType: parsed.businessType ?? defaultTemplate.businessType,
      customBusinessType: parsed.customBusinessType ?? defaultTemplate.customBusinessType
    };
  } catch {
    return defaultTemplate;
  }
}

export function writeTicketTemplate(tenantId: string, template: TicketTemplateConfig): TicketTemplateConfig {
  const normalizedTemplate: TicketTemplateConfig = {
    businessName: normalizeText(template.businessName) || 'POS DIAN',
    nit: normalizeText(template.nit) || 'N/A',
    address: normalizeText(template.address) || 'Dirección no configurada',
    phone: normalizeText(template.phone),
    footerMessage: normalizeText(template.footerMessage),
    logoUrl: normalizeText(template.logoUrl),
    printerWidth: template.printerWidth === '58mm' ? '58mm' : '80mm',
    businessType: template.businessType,
    customBusinessType: template.customBusinessType
  };

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(getStorageKey(tenantId), JSON.stringify(normalizedTemplate));
  }

  return normalizedTemplate;
}
