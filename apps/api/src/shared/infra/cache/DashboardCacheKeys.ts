export const CACHE_KEYS = {
  DASHBOARD_METRICS: 'platform:dashboard:metrics',
  GROWTH_METRICS:    'platform:dashboard:growth',
  BILLING_METRICS:   'platform:billing:metrics',
} as const;

export const INVALIDATION_PATTERNS = [
  'platform:dashboard:*',
  'platform:billing:*',
];
