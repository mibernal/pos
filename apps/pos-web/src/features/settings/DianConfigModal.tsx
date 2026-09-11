import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Modal } from '../../components/ui';
import type { TenantTaxMode } from '../../lib/api';
import { useSession } from '../auth';
import { useApi } from '../auth';
import { settingsKeys } from '../../shared/query-keys';

function taxModeLabel(taxMode: TenantTaxMode): string {
  return taxMode === 'INC_RESTAURANT' ? 'Incluye INC' : 'Incluye IVA';
}

export function DianConfigModal({
  isOpen,
  onClose,
  onSaved
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (taxMode: TenantTaxMode) => void;
}) {
  const api = useApi();
  const { role, tenantId } = useSession();
  const queryClient = useQueryClient();
  const [elegido, setElegido] = useState<TenantTaxMode | null>(null);

  const puedeVerlo = role === 'ADMIN' || role === 'TENANT_OWNER';

  // El perfil se pide al abrir, no al montar: el modal vive siempre en el armazón de la
  // aplicación y pedirlo antes sería una petición por cada arranque que nadie mira.
  const consulta = useQuery({
    queryKey: settingsKeys.tenantProfile(tenantId),
    queryFn: () => api.getCurrentTenantProfile(),
    enabled: isOpen && puedeVerlo
  });

  const profile = consulta.data ?? null;
  const draftTaxMode = elegido ?? profile?.taxMode ?? 'IVA';

  const guardar = useMutation({
    mutationFn: (taxMode: TenantTaxMode) => api.updateTenantTaxProfile(tenantId!, taxMode),
    onSuccess: async (updated) => {
      onSaved(updated.taxMode);
      // El régimen es parte del perfil del comercio, y el perfil se lee también fuera de
      // aquí —el encabezado del tiquete, por ejemplo—: invalidar la clave común es lo que
      // pone al día a todos.
      await queryClient.invalidateQueries({ queryKey: settingsKeys.tenantProfile(tenantId) });
    }
  });

  const loading = consulta.isPending;
  const saving = guardar.isPending;
  const message = guardar.isSuccess ? 'Configuración DIAN actualizada.' : null;
  const error = consulta.error
    ? (consulta.error instanceof Error
        ? consulta.error.message
        : 'No fue posible cargar la configuración DIAN')
    : guardar.error
      ? (guardar.error instanceof Error
          ? guardar.error.message
          : 'No fue posible actualizar la configuración DIAN')
      : null;

  function cerrar() {
    // Al cerrar se olvidan lo tecleado y el aviso de la última vez: quien vuelva a abrir
    // tiene que ver lo que hay en el servidor, no lo que quedó de la visita anterior.
    setElegido(null);
    guardar.reset();
    onClose();
  }

  if (!isOpen || !puedeVerlo || !tenantId) {
    return null;
  }

  function handleSave() {
    if (!tenantId) {
      return;
    }
    guardar.mutate(draftTaxMode);
  }

  return (
    <Modal ariaLabel="Configurar DIAN" onClose={cerrar}>
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
                onChange={(event) => setElegido(event.target.value as TenantTaxMode)}
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
                onClick={cerrar}
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
