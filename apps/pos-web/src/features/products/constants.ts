export const PRODUCT_TAX_CATEGORY_OPTIONS = [
  { value: 'IVA_19', label: 'IVA 19%' },
  { value: 'IVA_5', label: 'IVA 5%' },
  { value: 'IVA_0', label: 'IVA 0%' },
  { value: 'EXEMPT', label: 'Exento' },
  { value: 'EXCLUDED', label: 'Excluido' },
  { value: 'INC_8', label: 'INC 8%' }
] as const;

export type ProductTaxCategoryOption = (typeof PRODUCT_TAX_CATEGORY_OPTIONS)[number]['value'];

export function getProductTaxCategoryLabel(value: ProductTaxCategoryOption): string {
  return PRODUCT_TAX_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
