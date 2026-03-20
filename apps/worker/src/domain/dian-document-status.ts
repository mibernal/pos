import type { DianProviderResultStatus, DianStatus } from '@pos-dian/shared';

export interface DianStatusTransition {
  from: DianStatus;
  to: DianStatus;
}

export interface DianStatusTransitionPlan {
  currentStatus: DianStatus;
  providerStatus: DianProviderResultStatus;
  finalStatus: DianStatus;
  transitions: DianStatusTransition[];
}

const allowedTransitions: Record<DianStatus, readonly DianStatus[]> = {
  PENDING: ['SENT', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: []
};

function hasCude(cude: string | null): boolean {
  return typeof cude === 'string' && cude.trim().length > 0;
}

export function isDianStatusTransitionAllowed(from: DianStatus, to: DianStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function formatDianStatusTransitions(transitions: DianStatusTransition[]): string {
  if (transitions.length === 0) {
    return 'NONE';
  }

  return transitions.map((transition) => `${transition.from}->${transition.to}`).join(', ');
}

export function getDianEmissionBlockReason(status: DianStatus, cude: string | null): string | null {
  if (hasCude(cude)) {
    return 'document already has CUDE';
  }

  if (status === 'SENT') {
    return 'document already emitted';
  }

  if (status === 'ACCEPTED') {
    return 'document already accepted';
  }

  if (status === 'REJECTED') {
    return 'document already rejected';
  }

  return null;
}

export function planDianStatusTransition(
  currentStatus: DianStatus,
  providerStatus: DianProviderResultStatus
): DianStatusTransitionPlan {
  const transitions: DianStatusTransition[] = [];

  if (providerStatus === 'ACCEPTED' && currentStatus === 'PENDING') {
    transitions.push(
      {
        from: 'PENDING',
        to: 'SENT'
      },
      {
        from: 'SENT',
        to: 'ACCEPTED'
      }
    );
  } else {
    if (!isDianStatusTransitionAllowed(currentStatus, providerStatus)) {
      throw new Error(`Invalid DIAN status transition: ${currentStatus} -> ${providerStatus}`);
    }

    transitions.push({
      from: currentStatus,
      to: providerStatus
    });
  }

  return {
    currentStatus,
    providerStatus,
    finalStatus: transitions[transitions.length - 1]!.to,
    transitions
  };
}
