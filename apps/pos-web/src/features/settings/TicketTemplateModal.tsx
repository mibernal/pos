import { useEffect, useState } from 'react';
import { updateTenantBusinessProfileBodySchema, BUSINESS_TYPE_CATALOG } from '@pos-dian/shared';
import { Banner, Modal, BusinessTypeSelector } from '../../components/ui';
import type { PosApiClient } from '../../types';
import type { AuthSession } from '../../lib/api/client';
import type { TicketTemplateConfig } from '../../lib/ticket-template';

export function TicketTemplateModal({
  api,
  isOpen,
  onClose,
  onSave,
  template,
  session
}: {
  api: PosApiClient;
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: TicketTemplateConfig) => void;
  template: TicketTemplateConfig;
  session: AuthSession;
}) {
  const [draft, setDraft] = useState<TicketTemplateConfig & { businessType?: string, customBusinessType?: string }>(template);
  const [modules, setModules] = useState({
    enable_tables: session.user.enableTables || false,
    enable_delivery: session.user.enableDelivery || false,
    enable_waiters: session.user.enableWaiters || false,
    enable_split_bill: session.user.enableSplitBill || false,
    enable_tips: session.user.enableTips || false,
    enable_kitchen: session.user.enableKitchen || false,
    enable_kitchen_display: session.user.enableKitchenDisplay || false,
    enable_kitchen_tickets: session.user.enableKitchenTickets || false,
    enable_kitchen_printing: session.user.enableKitchenPrinting || false,
    enable_order_rounds: session.user.enableOrderRounds || false,
    enable_product_modifiers: session.user.enableProductModifiers || false,
    enable_reservations: session.user.enableReservations || false,
    enable_waiter_shifts: session.user.enableWaiterShifts || false,
    enable_qr_menu: session.user.enableQrMenu || false
  });

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
      footerMessage: draft.footerMessage.trim() || null,
      businessType: draft.businessType || undefined,
      customBusinessType: draft.customBusinessType?.trim() || undefined
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
      // Update Modules via new TMM endpoint
      await api.updateTenantModules({
        modules,
        reason: 'Actualización de configuración por el administrador'
      });

      const updated = await api.updateTenantBusinessProfile(parsed.data);
      onSave({
        businessName: updated.businessName,
        nit: updated.nit,
        address: updated.address,
        phone: updated.phone ?? '',
        footerMessage: updated.footerMessage ?? '',
        logoUrl: draft.logoUrl.trim(),
        printerWidth: draft.printerWidth,
        businessType: updated.businessType ?? 'OTHER',
        customBusinessType: updated.customBusinessType ?? undefined
      });
      setMessage('Configuración comercial actualizada.');
      onClose();
    } catch (saveError: any) {
      if (saveError.body?.code === 'MODULE_DEACTIVATION_CONFLICT') {
        setError(saveError.body.message || 'No se pueden desactivar los módulos porque están en uso.');
      } else {
        setError(
          saveError instanceof Error
            ? saveError.message
            : 'No fue posible guardar la configuración del negocio'
        );
      }
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
          <br />
          <strong>Nota:</strong> Si cambias el tipo de negocio, cierra sesión y vuelve a entrar para actualizar tus permisos de módulos.
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginTop: '0.5rem' }}>
            <label className="field">
              <span>Tipo de Negocio y Módulos</span>
            </label>
            <BusinessTypeSelector
              value={draft.businessType as any || 'OTHER'}
              onChange={(value) => updateDraft('businessType', value)}
              modules={modules}
              onModulesChange={setModules}
              layout="grid"
            />

            {draft.businessType === 'OTHER' ? (
              <label className="field" style={{ marginTop: '0.5rem' }}>
                <span>Especificar Tipo</span>
                <input
                  placeholder="Ej. Barbería"
                  value={draft.customBusinessType || ''}
                  onChange={(event) => updateDraft('customBusinessType', event.target.value)}
                  disabled={saving}
                />
              </label>
            ) : null}
          </div>

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
