import { useEffect, useState } from 'react';
import { Banner, Modal } from '../../components/ui';
import type { AdminTenantProfile, TenantTaxMode } from '../../lib/api';
import type { PosApiClient } from '../../types';
import { useSession } from '../auth';

function taxModeLabel(taxMode: TenantTaxMode): string {
  return taxMode === 'INC_RESTAURANT' ? 'Incluye INC' : 'Incluye IVA';
}

export function DianConfigModal({
  api,
  isOpen,
  onClose,
  onSaved
}: {
  api: PosApiClient;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (taxMode: TenantTaxMode) => void;
}) {
  const { role, tenantId } = useSession();
  const [profile, setProfile] = useState<AdminTenantProfile | null>(null);
  const [draftTaxMode, setDraftTaxMode] = useState<TenantTaxMode>('IVA');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || role !== 'ADMIN') {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);
    setMessage(null);

    void api
      .getCurrentTenantProfile()
      .then((currentProfile) => {
        if (cancelled) {
          return;
        }

        setProfile(currentProfile);
        setDraftTaxMode(currentProfile.taxMode);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'No fue posible cargar la configuración DIAN'
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, isOpen, role]);

  if (!isOpen || role !== 'ADMIN' || !tenantId) {
    return null;
  }

  async function handleSave() {
    if (!tenantId) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const updated = await api.updateTenantTaxProfile(tenantId, draftTaxMode);
      setProfile(updated);
      setDraftTaxMode(updated.taxMode);
      setMessage('Configuración DIAN actualizada.');
      onSaved(updated.taxMode);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No fue posible actualizar la configuración DIAN'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal ariaLabel="Configurar DIAN" onClose={onClose}>
      <header className="section-heading" style={{ marginBottom: '1.5rem' }}>
        <div className="heading-copy">
          <h3>Configuración Legal y Tributaria</h3>
          <p>Define los parámetros de facturación ante la DIAN</p>
        </div>
      </header>

      <div className="stack-md">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Banner tone="info">Sincronizando con el servidor...</Banner>
          </div>
        ) : (
          <>
            {profile && (
              <div className="metric-card" style={{ marginBottom: '1.5rem', padding: '1.25rem', background: 'var(--color-slate-50)', border: '1px solid var(--color-slate-200)' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-slate-400)', textTransform: 'uppercase' }}>Negocio Vinculado</span>
                <strong style={{ display: 'block', fontSize: '1rem', color: 'var(--color-slate-900)', marginTop: '0.25rem' }}>{profile.businessName}</strong>
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)', marginTop: '0.25rem' }}>
                  NIT {profile.nit} · <span style={{ color: 'var(--color-primary-600)', fontWeight: 600 }}>{taxModeLabel(profile.taxMode)}</span>
                </div>
              </div>
            )}
            
            {error && <div style={{ marginBottom: '1rem' }}><Banner tone="error">{error}</Banner></div>}
            {message && <div style={{ marginBottom: '1rem' }}><Banner tone="success">{message}</Banner></div>}

            <label className="field" style={{ display: 'grid', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>Régimen Tributario</span>
              <select
                value={draftTaxMode}
                onChange={(event) => setDraftTaxMode(event.target.value as TenantTaxMode)}
                disabled={loading || saving}
                style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-200)', fontSize: '0.875rem', background: '#ffffff' }}
              >
                <option value="IVA">IVA (Régimen Común)</option>
                <option value="INC_RESTAURANT">INC (Impuesto Nacional al Consumo)</option>
              </select>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.4rem' }}>
                Este ajuste afecta el cálculo de impuestos en todas las ventas.
              </p>
            </label>

            <div className="row-actions" style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                className="button"
                onClick={() => void handleSave()} 
                disabled={loading || saving}
                style={{ flex: 2, background: 'var(--color-primary-600)', color: '#ffffff' }}
              >
                {saving ? 'Aplicando...' : 'Guardar Cambios Legales'}
              </button>
              <button 
                className="ghost-button" 
                type="button" 
                onClick={onClose}
                style={{ flex: 1 }}
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
