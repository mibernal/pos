export type SubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED';

export type SubscriptionEventType =
  | 'TRIAL_STARTED'
  | 'ACTIVATED'
  | 'RENEWAL_ATTEMPTED'
  | 'RENEWAL_SUCCEEDED'
  | 'RENEWAL_FAILED'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'REACTIVATED'
  | 'PLAN_CHANGED'
  | 'GRACE_PERIOD_STARTED'
  | 'GRACE_PERIOD_EXPIRED';
