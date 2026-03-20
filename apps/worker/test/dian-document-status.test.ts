import { describe, expect, it } from 'vitest';
import {
  formatDianStatusTransitions,
  getDianEmissionBlockReason,
  isDianStatusTransitionAllowed,
  planDianStatusTransition
} from '../src/domain/dian-document-status.js';

describe('dian document status transitions', () => {
  it('allows the declared DIAN transitions', () => {
    expect(isDianStatusTransitionAllowed('PENDING', 'SENT')).toBe(true);
    expect(isDianStatusTransitionAllowed('SENT', 'ACCEPTED')).toBe(true);
    expect(isDianStatusTransitionAllowed('SENT', 'REJECTED')).toBe(true);
    expect(isDianStatusTransitionAllowed('PENDING', 'REJECTED')).toBe(true);
  });

  it('builds the expected transition path when provider jumps from pending to accepted', () => {
    const plan = planDianStatusTransition('PENDING', 'ACCEPTED');

    expect(plan.finalStatus).toBe('ACCEPTED');
    expect(plan.transitions).toEqual([
      {
        from: 'PENDING',
        to: 'SENT'
      },
      {
        from: 'SENT',
        to: 'ACCEPTED'
      }
    ]);
    expect(formatDianStatusTransitions(plan.transitions)).toBe('PENDING->SENT, SENT->ACCEPTED');
  });

  it('rejects invalid DIAN transitions', () => {
    expect(() => planDianStatusTransition('ACCEPTED', 'SENT')).toThrowError(
      /Invalid DIAN status transition/
    );
    expect(() => planDianStatusTransition('REJECTED', 'ACCEPTED')).toThrowError(
      /Invalid DIAN status transition/
    );
  });

  it('blocks emission when the document was already emitted or finalized', () => {
    expect(getDianEmissionBlockReason('PENDING', null)).toBeNull();
    expect(getDianEmissionBlockReason('SENT', null)).toBe('document already emitted');
    expect(getDianEmissionBlockReason('ACCEPTED', null)).toBe('document already accepted');
    expect(getDianEmissionBlockReason('REJECTED', null)).toBe('document already rejected');
    expect(getDianEmissionBlockReason('PENDING', 'CUDE-123')).toBe('document already has CUDE');
  });
});
