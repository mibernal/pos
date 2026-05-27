import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, ShellMessage } from '../../components/ui';
import { useBranchCashSession } from '../cash-sessions';
import { formatMoneyFromCents } from '../../lib/format';
import type { BranchItem } from '../../lib/api';
import type { PosContext } from '../../lib/session';
import type { PosApiClient } from '../../types';

export function BranchSetupScreen({
  api,
  onReady
}: {
  api: PosApiClient;
  onReady: (context: PosContext) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [openingAmountPesos, setOpeningAmountPesos] = useState(10000);
  const [opening, setOpening] = useState(false);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId]
  );

  const { checkingSession, currentSession, sessionError, setCurrentSession } = useBranchCashSession({
    api,
    branches,
    selectedBranchId
  });

  const loadBranches = useCallback(async (showFullLoader = true) => {
    if (showFullLoader) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const response = await api.listBranches();
      setBranches(response.items);
      setSelectedBranchId((current) => current || response.items[0]?.id || '');
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'No fue posible cargar las sucursales disponibles'
      );
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [api]);

  useEffect(() => {
    void loadBranches(true);
  }, [loadBranches]);

  useEffect(() => {
    if (sessionError) {
      setError(sessionError);
    }
  }, [sessionError]);

  async function handleOpenCashSession() {
    if (!selectedBranchId) {
      setError('Selecciona una sucursal');
      return;
    }

    setOpening(true);
    setError(null);

    try {
      const opened = await api.openCashSession(selectedBranchId, openingAmountPesos * 100);
      setCurrentSession(opened.cash_session);

      if (!selectedBranch) {
        return;
      }

      onReady({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        branchAddress: selectedBranch.address,
        cashSessionId: opened.cash_session.id
      });
    } catch (openError) {
      setError(
        openError instanceof Error ? openError.message : 'No fue posible abrir la sesión de caja'
      );
    } finally {
      setOpening(false);
    }
  }

  function handleContinue() {
    if (!selectedBranch || !currentSession) {
      setError('No hay una sesión de caja abierta para continuar');
      return;
    }

    onReady({
      branchId: selectedBranch.id,
      branchName: selectedBranch.name,
      branchAddress: selectedBranch.address,
      cashSessionId: currentSession.id
    });
  }

  if (loading) {
    return <ShellMessage title="Cargando sucursales..." subtitle="Preparando caja" />;
  }

  return (
    <main className="auth-layout" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-slate-50)', padding: '1rem' }}>
      <section className="setup-card" style={{ width: '100%', maxWidth: '480px', background: '#ffffff', padding: '2.5rem', borderRadius: 'var(--radius-2xl)', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', border: '1px solid var(--color-slate-100)' }}>
        <header className="setup-header" style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ width: '48px', height: '48px', background: 'var(--color-primary-600)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem', color: '#ffffff', fontSize: '1.25rem' }}>
            🏢
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem' }}>PUNTO DE VENTA</h1>
          <p className="subtle-text" style={{ fontSize: '0.875rem' }}>Selecciona tu sucursal para abrir caja y comenzar</p>
        </header>

        <div className="stack-lg">
          {branches.length === 0 ? (
            <Banner tone="error">No se encontraron sucursales vinculadas a tu cuenta.</Banner>
          ) : (
            <>
              <label className="field" style={{ display: 'grid', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>Sucursal Asignada</span>
                <select
                  value={selectedBranchId}
                  onChange={(event) => {
                    setError(null);
                    setSelectedBranchId(event.target.value);
                  }}
                  style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-200)', fontSize: '0.875rem', background: '#ffffff' }}
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
                {selectedBranch && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)', marginTop: '0.25rem' }}>
                    📍 {selectedBranch.address}
                  </p>
                )}
              </label>

              {checkingSession && (
                <div style={{ marginTop: '1rem' }}>
                  <Banner tone="info">Sincronizando estado de caja...</Banner>
                </div>
              )}

              {currentSession ? (
                <div className="stack-md" style={{ marginTop: '1.5rem' }}>
                  <Banner tone="success">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <strong>Caja Abierta</strong>
                      <span style={{ fontSize: '0.75rem' }}>Inició: {new Date(currentSession.opened_at).toLocaleString('es-CO')}</span>
                    </div>
                  </Banner>
                  <button 
                    className="button"
                    onClick={handleContinue}
                    style={{ 
                      width: '100%', 
                      padding: '0.875rem', 
                      background: 'var(--color-primary-600)', 
                      color: '#ffffff', 
                      fontWeight: 700, 
                      borderRadius: 'var(--radius-lg)',
                      marginTop: '1rem'
                    }}
                  >
                    Continuar al Panel
                  </button>
                </div>
              ) : (
                <div className="stack-md" style={{ marginTop: '1.5rem' }}>
                  <label className="field" style={{ display: 'grid', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>Monto Inicial (Base de Caja COP)</span>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={openingAmountPesos}
                        onChange={(event) => setOpeningAmountPesos(Number(event.target.value))}
                        style={{ padding: '0.75rem 1rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-slate-200)', fontSize: '0.875rem', width: '100%' }}
                      />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>
                      Monto sugerido para vueltas: <strong>{formatMoneyFromCents(openingAmountPesos * 100)}</strong>
                    </p>
                  </label>
                  <button 
                    className="button"
                    disabled={opening} 
                    onClick={() => void handleOpenCashSession()}
                    style={{ 
                      width: '100%', 
                      padding: '0.875rem', 
                      background: 'var(--color-primary-600)', 
                      color: '#ffffff', 
                      fontWeight: 700, 
                      borderRadius: 'var(--radius-lg)',
                      marginTop: '1rem',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    {opening ? 'Iniciando Sesión...' : 'Abrir Caja y Comenzar'}
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <div style={{ marginTop: '1.5rem' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}
          
          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button 
              className="ghost-button" 
              disabled={isRefreshing}
              onClick={() => void loadBranches(false)}
              style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}
            >
              {isRefreshing ? '🔄 Actualizando...' : '🔄 Actualizar Datos de Sucursales'}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
