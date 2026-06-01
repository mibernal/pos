import React from 'react';
import { Banner } from '../../../../components/ui';
import { formatMoneyFromCents } from '../../../../lib/format';
import { formatEditableMoneyFromCents } from '../../utils';

export function CashPaymentPanel({
  totalCents,
  cashReceivedDraft,
  setCashReceivedDraft,
  cashReceivedCents,
  cashChangeCents,
  cashMissingCents,
  cashInputRef
}: {
  totalCents: number;
  cashReceivedDraft: string;
  setCashReceivedDraft: (val: string) => void;
  cashReceivedCents: number;
  cashChangeCents: number;
  cashMissingCents: number;
  cashInputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="checkout-section stack-md">
      <div className="section-heading">
        <div>
          <h3>Efectivo</h3>
          <p>Registra lo recibido y valida el cambio antes de cerrar la venta</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={() => setCashReceivedDraft(formatEditableMoneyFromCents(totalCents))}
        >
          Exacto
        </button>
      </div>

      <label className="field">
        <span>Recibido (COP)</span>
        <input
          ref={cashInputRef}
          inputMode="numeric"
          min={0}
          step="50"
          type="number"
          value={cashReceivedDraft}
          onChange={(event) => setCashReceivedDraft(event.target.value)}
        />
      </label>

      <div className="checkout-mini-stats">
        <div className="metric-card">
          <span>Recibido</span>
          <strong>{formatMoneyFromCents(cashReceivedCents)}</strong>
        </div>
        <div className="metric-card">
          <span>Cambio</span>
          <strong>{formatMoneyFromCents(cashChangeCents)}</strong>
        </div>
      </div>

      {cashMissingCents > 0 ? (
        <Banner tone="warning">
          Faltan {formatMoneyFromCents(cashMissingCents)} para completar el cobro en efectivo.
        </Banner>
      ) : null}
    </div>
  );
}
