import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, ShellMessage } from '../../components/ui';
import { useBranchCashSession } from '../cash-sessions';
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
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [openingAmountCents, setOpeningAmountCents] = useState(100000);
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

  const loadBranches = useCallback(async () => {
    setLoading(true);
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
    }
  }, [api]);

  useEffect(() => {
    void loadBranches();
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
      const opened = await api.openCashSession(selectedBranchId, openingAmountCents);
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
    <main className="auth-layout">
      <section className="setup-card">
        <header className="setup-header">
          <h1>Selecciona sucursal y caja</h1>
          <button className="ghost-button" onClick={() => void loadBranches()}>
            Recargar
          </button>
        </header>

        {branches.length === 0 ? (
          <Banner tone="error">No hay sucursales disponibles para este usuario.</Banner>
        ) : (
          <>
            <label className="field">
              <span>Sucursal</span>
              <select
                value={selectedBranchId}
                onChange={(event) => {
                  setError(null);
                  setSelectedBranchId(event.target.value);
                }}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} - {branch.address}
                  </option>
                ))}
              </select>
            </label>

            {checkingSession ? <Banner tone="info">Verificando caja actual...</Banner> : null}

            {currentSession ? (
              <div className="stack-md">
                <Banner tone="success">
                  Caja abierta desde {new Date(currentSession.opened_at).toLocaleString('es-CO')}
                </Banner>
                <button onClick={handleContinue}>Continuar con caja actual</button>
              </div>
            ) : (
              <div className="stack-md">
                <label className="field">
                  <span>Monto inicial de caja (centavos)</span>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={openingAmountCents}
                    onChange={(event) => setOpeningAmountCents(Number(event.target.value))}
                  />
                </label>
                <button disabled={opening} onClick={() => void handleOpenCashSession()}>
                  {opening ? 'Abriendo caja...' : 'Abrir caja'}
                </button>
              </div>
            )}
          </>
        )}

        {error ? <Banner tone="error">{error}</Banner> : null}
      </section>
    </main>
  );
}
