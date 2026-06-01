import { useState, useMemo, useRef, useEffect } from 'react';
import type { PaymentMethod } from '../../../../types';
import { formatEditableMoneyFromCents, parseVisibleMoneyToCents } from '../../utils';

export type SimplePaymentMethod = Exclude<PaymentMethod, 'MIXED'>;

export interface MixedPaymentLine {
  amountCents: number;
  amountDraft: string;
  id: string;
  method: SimplePaymentMethod;
  approvalCode?: string;
}

function createLineId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `line-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMixedPaymentLine(method: SimplePaymentMethod, amountCents: number): MixedPaymentLine {
  return {
    amountCents,
    amountDraft: formatEditableMoneyFromCents(amountCents),
    id: createLineId(),
    method,
    approvalCode: ''
  };
}

export function buildDefaultMixedLines(totalCents: number): MixedPaymentLine[] {
  return [
    createMixedPaymentLine('CASH', totalCents),
    createMixedPaymentLine('CARD', 0)
  ];
}

export function suggestNextMethod(lines: ReadonlyArray<MixedPaymentLine>): SimplePaymentMethod {
  const usedMethods = new Set(lines.map((line) => line.method));
  if (!usedMethods.has('CARD')) return 'CARD';
  if (!usedMethods.has('TRANSFER')) return 'TRANSFER';
  return 'CASH';
}

export function useCheckoutPayment(totalCents: number, isOpen: boolean) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashReceivedDraft, setCashReceivedDraft] = useState('0');
  const [cardApprovalCode, setCardApprovalCode] = useState('');
  
  // Terminal state
  const [terminalProcessing, setTerminalProcessing] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalSuccess, setTerminalSuccess] = useState(false);
  
  // Mixed state
  const [mixedLines, setMixedLines] = useState<MixedPaymentLine[]>(() =>
    buildDefaultMixedLines(totalCents)
  );

  const cashInputRef = useRef<HTMLInputElement | null>(null);
  const mixedFirstInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on open
  useEffect(() => {
    if (!isOpen) return;
    setCashReceivedDraft(formatEditableMoneyFromCents(totalCents));
    setCardApprovalCode('');
    setMixedLines(buildDefaultMixedLines(totalCents));
    setTerminalProcessing(false);
    setTerminalError(null);
    setTerminalSuccess(false);
  }, [isOpen, totalCents]);

  useEffect(() => {
    if (!isOpen) return;
    const timeout = window.setTimeout(() => {
      if (paymentMethod === 'CASH') cashInputRef.current?.focus();
      if (paymentMethod === 'MIXED') mixedFirstInputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(timeout);
  }, [isOpen, paymentMethod]);

  // Cash Calculations
  const cashReceivedCents = parseVisibleMoneyToCents(cashReceivedDraft);
  const cashChangeCents = Math.max(0, cashReceivedCents - totalCents);
  const cashMissingCents = Math.max(0, totalCents - cashReceivedCents);
  const canConfirmCash = cashReceivedCents >= totalCents;

  // Mixed Calculations
  const positiveMixedLines = useMemo(
    () => mixedLines.filter((line) => line.amountCents > 0),
    [mixedLines]
  );
  
  const mixedEnteredCents = useMemo(
    () => positiveMixedLines.reduce((sum, line) => sum + line.amountCents, 0),
    [positiveMixedLines]
  );
  
  const mixedCashEnteredCents = useMemo(
    () => positiveMixedLines.filter(l => l.method === 'CASH').reduce((sum, line) => sum + line.amountCents, 0),
    [positiveMixedLines]
  );
  
  const mixedNonCashEnteredCents = mixedEnteredCents - mixedCashEnteredCents;
  const mixedDifferenceCents = totalCents - mixedEnteredCents;
  const mixedChangeCents = Math.max(0, mixedEnteredCents - totalCents);
  
  const hasValidMixedApprovalCodes = positiveMixedLines.every((line) => line.method !== 'CARD' || (line.approvalCode && line.approvalCode.trim().length >= 3));
  
  const canConfirmMixed = 
    positiveMixedLines.length >= 2 && 
    mixedEnteredCents >= totalCents && 
    mixedNonCashEnteredCents <= totalCents &&
    hasValidMixedApprovalCodes;

  // General Submission state
  const canSubmit = 
    totalCents > 0 &&
    (paymentMethod === 'CASH'
      ? canConfirmCash
      : paymentMethod === 'MIXED'
        ? canConfirmMixed
        : paymentMethod === 'CARD'
          ? (terminalSuccess || cardApprovalCode.trim().length >= 3)
          : true);

  return {
    paymentMethod,
    setPaymentMethod,
    
    // Cash
    cashReceivedDraft,
    setCashReceivedDraft,
    cashReceivedCents,
    cashChangeCents,
    cashMissingCents,
    cashInputRef,
    
    // Card / Terminal
    cardApprovalCode,
    setCardApprovalCode,
    terminalProcessing,
    setTerminalProcessing,
    terminalError,
    setTerminalError,
    terminalSuccess,
    setTerminalSuccess,
    
    // Mixed
    mixedLines,
    setMixedLines,
    positiveMixedLines,
    mixedEnteredCents,
    mixedCashEnteredCents,
    mixedNonCashEnteredCents,
    mixedDifferenceCents,
    mixedChangeCents,
    mixedFirstInputRef,
    
    // General
    canSubmit
  };
}
