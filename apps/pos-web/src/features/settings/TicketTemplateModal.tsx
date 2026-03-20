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
      <header className="section-heading" style={{ marginBottom: '1.5rem' }}>
        <div className="heading-copy">
          <h3>Perfil del Negocio</h3>
          <p>Configura los datos que aparecerán en tus facturas y tickets</p>
        </div>
      </header>

      <div className="stack-md">
        <p className="subtle-text">
          Estos datos se usan en el ticket y en la demo comercial del POS.
        </p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}

        <div className="field-group" style={{ display: 'grid', gap: '1rem' }}>
          <label className="field">
            <span>Razón Social / Nombre Comercial</span>
            <input
              placeholder="Ej. Mi Tienda S.A.S"
              value={draft.businessName}
              onChange={(event) => updateDraft('businessName', event.target.value)}
              disabled={saving}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label className="field">
              <span>NIT / Identificación</span>
              <input
                placeholder="900.000.000-0"
                value={draft.nit}
                onChange={(event) => updateDraft('nit', event.target.value)}
                disabled={saving}
              />
            </label>

            <label className="field">
              <span>Teléfono de Contacto</span>
              <input
                value={draft.phone}
                onChange={(event) => updateDraft('phone', event.target.value)}
                placeholder="Opcional"
                disabled={saving}
              />
            </label>
          </div>

          <label className="field">
            <span>Dirección Principal</span>
            <input
              placeholder="Calle 123 #45-67"
              value={draft.address}
              onChange={(event) => updateDraft('address', event.target.value)}
              disabled={saving}
            />
          </label>

          <label className="field">
            <span>Mensaje de Pie de Página (Ticket)</span>
            <textarea
              rows={2}
              value={draft.footerMessage}
              onChange={(event) => updateDraft('footerMessage', event.target.value)}
              placeholder="Ej. Gracias por su compra. Vuelva pronto."
              disabled={saving}
              style={{ resize: 'none' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <label className="field">
              <span>Papel Impresora</span>
              <select
                value={draft.printerWidth}
                onChange={(event) => updateDraft('printerWidth', event.target.value as '58mm' | '80mm')}
                disabled={saving}
              >
                <option value="80mm">Grande (80mm)</option>
                <option value="58mm">Pequeño (58mm)</option>
              </select>
            </label>

            <label className="field">
              <span>Logo (URL)</span>
              <input
                value={draft.logoUrl}
                onChange={(event) => updateDraft('logoUrl', event.target.value)}
                placeholder="https://..."
                disabled={saving}
              />
            </label>
          </div>
        </div>

        <div className="row-actions" style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
          <button 
            type="button" 
            className="button"
            onClick={() => void handleSave()} 
            disabled={saving}
            style={{ flex: 2, background: 'var(--color-primary-600)', color: '#ffffff' }}
          >
            {saving ? 'Guardando...' : 'Actualizar Perfil'}
          </button>
          <button 
            className="ghost-button" 
            type="button" 
            onClick={onClose} 
            disabled={saving}
            style={{ flex: 1 }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </Modal>
  );
}
