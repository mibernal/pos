import { useEffect, useState } from 'react';
import { updateTenantBusinessProfileBodySchema } from '@pos-dian/shared';
import { Banner, Modal } from '../../components/ui';
import type { PosApiClient } from '../../types';
import type { TicketTemplateConfig } from '../../lib/ticket-template';

export function TicketTemplateModal({
  api,
  isOpen,
  onClose,
  onSave,
  template
}: {
  api: PosApiClient;
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: TicketTemplateConfig) => void;
  template: TicketTemplateConfig;
}) {
  const [draft, setDraft] = useState<TicketTemplateConfig>(template);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraft(template);
      setError(null);
      setMessage(null);
    }
  }, [isOpen, template]);

  if (!isOpen) {
    return null;
  }

  function updateDraft(field: keyof TicketTemplateConfig, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleSave() {
    const payload = {
      businessName: draft.businessName.trim(),
      nit: draft.nit.trim(),
      address: draft.address.trim(),
      phone: draft.phone.trim() || null,
      footerMessage: draft.footerMessage.trim() || null
    };

    const parsed = updateTenantBusinessProfileBodySchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos del negocio');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updated = await api.updateTenantBusinessProfile(parsed.data);
      onSave({
        businessName: updated.businessName,
        nit: updated.nit,
        address: updated.address,
        phone: updated.phone ?? '',
        footerMessage: updated.footerMessage ?? '',
        logoUrl: draft.logoUrl.trim(),
        printerWidth: draft.printerWidth
      });
      setMessage('Configuración comercial actualizada.');
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No fue posible guardar la configuración del negocio'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal ariaLabel="Configurar negocio" onClose={onClose}>
      <div className="section-heading">
        <h3>Configuración del negocio</h3>
      </div>

      <div className="stack-md">
        <p className="subtle-text">
          Estos datos se usan en el ticket y en la demo comercial del POS.
        </p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}

        <label className="field">
          <span>Nombre del negocio</span>
          <input
            value={draft.businessName}
            onChange={(event) => updateDraft('businessName', event.target.value)}
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>NIT</span>
          <input
            value={draft.nit}
            onChange={(event) => updateDraft('nit', event.target.value)}
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>Dirección comercial</span>
          <input
            value={draft.address}
            onChange={(event) => updateDraft('address', event.target.value)}
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>Teléfono</span>
          <input
            value={draft.phone}
            onChange={(event) => updateDraft('phone', event.target.value)}
            placeholder="Opcional"
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>Mensaje final del ticket</span>
          <textarea
            rows={3}
            value={draft.footerMessage}
            onChange={(event) => updateDraft('footerMessage', event.target.value)}
            placeholder="Opcional"
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>Logo (URL opcional)</span>
          <input
            value={draft.logoUrl}
            onChange={(event) => updateDraft('logoUrl', event.target.value)}
            placeholder="https://..."
            disabled={saving}
          />
        </label>

        <label className="field">
          <span>Formato de impresora</span>
          <select
            value={draft.printerWidth}
            onChange={(event) => updateDraft('printerWidth', event.target.value as '58mm' | '80mm')}
            disabled={saving}
          >
            <option value="80mm">Ticket grande (80mm)</option>
            <option value="58mm">Ticket pequeño (58mm)</option>
          </select>
        </label>

        <div className="row-actions">
          <button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar negocio'}
          </button>
          <button className="ghost-button" type="button" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
