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
      <div className="section-heading">
        <h3>Configuración DIAN</h3>
      </div>

      <div className="stack-md">
        {loading ? <Banner tone="info">Cargando configuración...</Banner> : null}
        {profile ? (
          <div className="metric-card">
            <span>Negocio actual</span>
            <strong>{profile.businessName}</strong>
            <div className="subtle-text">
              NIT {profile.nit} · {taxModeLabel(profile.taxMode)}
            </div>
          </div>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}

        <label className="field">
          <span>Modo tributario</span>
          <select
            value={draftTaxMode}
            onChange={(event) => setDraftTaxMode(event.target.value as TenantTaxMode)}
            disabled={loading || saving}
          >
            <option value="IVA">IVA</option>
            <option value="INC_RESTAURANT">INC (Restaurante)</option>
          </select>
        </label>

        <div className="row-actions">
          <button type="button" onClick={() => void handleSave()} disabled={loading || saving}>
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
