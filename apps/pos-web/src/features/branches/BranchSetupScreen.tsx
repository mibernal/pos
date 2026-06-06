import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, ShellMessage } from '../../components/ui';
import { useBranchCashSession } from '../cash-sessions';
import { formatMoneyFromCents } from '../../lib/format';
import type { BranchItem, TerminalItem, AuthSession } from '../../lib/api';
import type { PosContext } from '../../lib/session';
import { useSession } from '../auth';
import type { PosApiClient } from '../../types';

interface TerminalCardProps {
  name: string;
  status: 'OPEN' | 'CLOSED' | 'ISSUE';
  lastActivity: string;
  currentUser?: string;
  onClick: () => void;
  selected?: boolean;
}

function TerminalCard({ name, status, lastActivity, currentUser, onClick, selected }: TerminalCardProps) {
  const statusConfig = {
    OPEN: { color: 'bg-green-500', text: 'text-green-700', bg: 'bg-green-50', label: 'Abierta' },
    CLOSED: { color: 'bg-slate-400', text: 'text-slate-700', bg: 'bg-slate-50', label: 'Cerrada' },
    ISSUE: { color: 'bg-orange-500', text: 'text-orange-700', bg: 'bg-orange-50', label: 'Incidencia' },
  };
  
  const current = statusConfig[status];

  return (
    <button 
      onClick={onClick}
      className={`group relative w-full flex flex-col p-5 text-left bg-white rounded-2xl border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${selected ? 'border-primary-500 ring-2 ring-primary-100 shadow-md' : 'border-slate-200 hover:border-primary-300 hover:shadow-md'}`}
      style={{
        border: selected ? '2px solid var(--color-primary-600)' : '1px solid var(--color-slate-200)',
        boxShadow: selected ? '0 4px 12px rgba(79, 70, 229, 0.15)' : 'var(--shadow-sm)',
        background: selected ? 'var(--color-primary-50)' : '#ffffff',
        cursor: 'pointer',
        borderRadius: '1rem',
        padding: '1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ padding: '0.5rem', background: selected ? '#ffffff' : 'var(--color-slate-50)', borderRadius: '0.5rem' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-slate-700)' }}>
             <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
             <line x1="8" y1="21" x2="16" y2="21"></line>
             <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </div>
        <span style={{ padding: '0.25rem 0.75rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.375rem', background: `var(--color-${status === 'OPEN' ? 'success' : 'slate'}-100)`, color: `var(--color-${status === 'OPEN' ? 'success' : 'slate'}-700)` }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: `var(--color-${status === 'OPEN' ? 'success' : 'slate'}-500)` }}></span>
          {current.label}
        </span>
      </div>
      
      <div>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-slate-900)', margin: '0 0 0.25rem 0' }}>{name}</h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-slate-500)', margin: 0 }}>ID: {lastActivity}</p>
      </div>
      
      {currentUser ? (
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--color-slate-100)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--color-primary-100)', color: 'var(--color-primary-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
            {currentUser.charAt(0)}
          </div>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-slate-600)', fontWeight: 500 }}>{currentUser}</span>
        </div>
      ) : (
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--color-slate-100)' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-slate-400)' }}>Sin operador</span>
        </div>
      )}
    </button>
  );
}

export function BranchSetupScreen({
  api,
  session,
  onReady
}: {
  api: PosApiClient;
  session: AuthSession | null;
  onReady: (context: PosContext) => void;
}) {
  const { logout } = useSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  
  // Step 1: Branches, Step 2: Terminals, Step 3: Open Cash
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [terminals, setTerminals] = useState<TerminalItem[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false);
  const [newTerminalName, setNewTerminalName] = useState('');

  const [openingAmountPesos, setOpeningAmountPesos] = useState(10000);
  const [opening, setOpening] = useState(false);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId) ?? null,
    [branches, selectedBranchId]
  );

  const selectedTerminal = useMemo(
    () => terminals.find((t) => t.id === selectedTerminalId) ?? null,
    [terminals, selectedTerminalId]
  );

  const { checkingSession, currentSession, sessionError, setCurrentSession } = useBranchCashSession({
    api,
    selectedTerminalId
  });

  const loadBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.listBranches();
      let availableBranches = response.items;
      if (session?.user?.role !== 'ADMIN' && session?.user?.role !== 'TENANT_OWNER' && session?.user?.branchIds?.length) {
        availableBranches = response.items.filter(b => session.user?.branchIds?.includes(b.id));
      }
      setBranches(availableBranches);
      if (availableBranches.length === 1 && availableBranches[0]) {
        handleSelectBranch(availableBranches[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No fue posible cargar sucursales');
    } finally {
      setLoading(false);
    }
  }, [api, session]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  const handleSelectBranch = async (branchId: string) => {
    setSelectedBranchId(branchId);
    setStep(2);
    try {
      const response = await api.listTerminals(branchId);
      setTerminals(response.terminals);
      if (response.terminals.length === 1 && response.terminals[0]) {
        setSelectedTerminalId(response.terminals[0].id);
        setStep(3);
      }
    } catch (err) {
      console.error('Error loading terminals', err);
    }
  };

  useEffect(() => {
    if (sessionError) setError(sessionError);
  }, [sessionError]);

  const handleCreateTerminal = async () => {
    if (!newTerminalName.trim() || !selectedBranchId) return;
    setError(null);
    try {
      const created = await api.createTerminal({
        branch_id: selectedBranchId,
        name: newTerminalName.trim()
      });
      setTerminals(prev => [...prev, created]);
      setSelectedTerminalId(created.id);
      setIsCreatingTerminal(false);
      setNewTerminalName('');
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear terminal');
    }
  };

  async function handleOpenCashSession() {
    if (!selectedBranchId || !selectedTerminalId) return;
    setOpening(true);
    setError(null);

    try {
      localStorage.setItem('pos_terminal_id', selectedTerminalId);
      const opened = await api.openCashSession(selectedBranchId, selectedTerminalId, openingAmountPesos * 100);
      setCurrentSession(opened.cash_session);

      if (!selectedBranch || !selectedTerminal) return;

      onReady({
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        branchAddress: selectedBranch.address,
        terminalId: selectedTerminal.id,
        terminalName: selectedTerminal.name,
        cashSessionId: opened.cash_session.id
      });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'No fue posible abrir la caja');
    } finally {
      setOpening(false);
    }
  }

  function handleContinue() {
    if (!selectedBranch || !selectedTerminal || !currentSession) return;
    localStorage.setItem('pos_terminal_id', selectedTerminalId);
    onReady({
      branchId: selectedBranch.id,
      branchName: selectedBranch.name,
      branchAddress: selectedBranch.address,
      terminalId: selectedTerminal.id,
      terminalName: selectedTerminal.name,
      cashSessionId: currentSession.id
    });
  }

  if (loading) {
    return <ShellMessage title="Cargando entorno..." subtitle="Obteniendo sucursales y terminales" />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-slate-50)', fontFamily: 'var(--font-sans)' }}>
      {/* Top Header with Logout */}
      <header style={{ 
        padding: '1rem 1.5rem', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        background: '#ffffff', 
        borderBottom: '1px solid var(--color-slate-200)',
        boxShadow: 'var(--shadow-sm)' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '32px', height: '32px', background: 'var(--color-primary-600)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontSize: '1rem', fontWeight: 700 }}>
            P
          </div>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>POS Cloud</span>
        </div>
        <button 
          onClick={logout}
          style={{ background: 'transparent', border: 'none', color: 'var(--color-error-600)', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', padding: '0.5rem 1rem', borderRadius: '0.5rem' }}
          onMouseOver={e => e.currentTarget.style.background = 'var(--color-error-50)'}
          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
        >
          Cerrar Sesión
        </button>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
        <section style={{ width: '100%', maxWidth: step === 1 ? '800px' : '600px', background: '#ffffff', padding: 'clamp(1.5rem, 5vw, 3rem)', borderRadius: '1.5rem', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-slate-100)', transition: 'max-width 0.3s ease', position: 'relative' }}>
          
          <header style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
            {step > 1 && (
              <button onClick={() => setStep(step === 3 ? 2 : 1)} style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', background: 'var(--color-slate-100)', border: 'none', padding: '0.5rem 1rem', borderRadius: '1rem', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)' }}>
                &larr; Atrás
              </button>
            )}
            <div style={{ width: '56px', height: '56px', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {step === 1 ? <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path> : <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>}
              </svg>
            </div>
            <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 1.875rem)', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
              {step === 1 ? 'Selecciona una Sucursal' : step === 2 ? 'Selecciona una Caja' : 'Estado de la Caja'}
            </h1>
            <p style={{ fontSize: '1rem', color: 'var(--color-slate-500)' }}>
              {step === 1 ? '¿Desde dónde vas a operar hoy?' : step === 2 ? `Sucursal ${selectedBranch?.name}` : `Terminal ${selectedTerminal?.name}`}
            </p>
          </header>

          {error && (
            <div style={{ marginBottom: '2rem' }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          {/* STEP 1: BRANCHES */}
          {step === 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              {branches.map(branch => (
                <button
                  key={branch.id}
                  onClick={() => handleSelectBranch(branch.id)}
                  style={{
                    padding: '1.5rem', background: '#fff', border: '1px solid var(--color-slate-200)', borderRadius: '1rem', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', boxShadow: 'var(--shadow-sm)'
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary-400)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--color-slate-200)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ padding: '0.5rem', background: 'var(--color-slate-100)', borderRadius: '0.5rem' }}>🏢</div>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)', margin: 0 }}>{branch.name}</h3>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', margin: '0 0 1rem 0' }}>{branch.address}</p>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary-600)' }}>
                    Seleccionar sucursal &rarr;
                  </div>
                </button>
              ))}
              {branches.length === 0 && !loading && (
                <Banner tone="warning">No tienes sucursales asignadas. Contacta al administrador.</Banner>
              )}
            </div>
          )}

          {/* STEP 2: TERMINALS */}
          {step === 2 && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {terminals.map(terminal => (
                  <TerminalCard
                    key={terminal.id}
                    name={terminal.name}
                    status={terminal.is_active ? 'OPEN' : 'CLOSED'} // Simplified status for visual purposes
                    lastActivity={terminal.id.substring(0, 8)}
                    onClick={() => {
                      setSelectedTerminalId(terminal.id);
                      setStep(3);
                    }}
                  />
                ))}
              </div>

              {(session?.user?.role === 'ADMIN' || session?.user?.role === 'TENANT_OWNER') && (
                <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px dashed var(--color-slate-200)' }}>
                  {isCreatingTerminal ? (
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={newTerminalName}
                        onChange={(e) => setNewTerminalName(e.target.value)}
                        placeholder="Nombre de la nueva caja (Ej. Caja Principal)"
                        style={{ flex: '1 1 200px', padding: '0.875rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--color-slate-300)', fontSize: '0.875rem' }}
                        autoFocus
                      />
                      <button
                        onClick={() => void handleCreateTerminal()}
                        disabled={!newTerminalName.trim()}
                        style={{ padding: '0.875rem 1.5rem', background: 'var(--color-primary-600)', color: '#fff', border: 'none', borderRadius: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Guardar
                      </button>
                      <button onClick={() => setIsCreatingTerminal(false)} style={{ padding: '0.875rem 1rem', background: 'none', border: 'none', color: 'var(--color-slate-500)', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setIsCreatingTerminal(true)} style={{ width: '100%', padding: '1rem', border: '2px dashed var(--color-slate-300)', borderRadius: '1rem', background: 'transparent', color: 'var(--color-slate-500)', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.borderColor = 'var(--color-primary-400)'} onMouseOut={e => e.currentTarget.style.borderColor = 'var(--color-slate-300)'}>
                      + Crear nueva caja registradora
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: OPEN CASH SESSION */}
          {step === 3 && (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
              {checkingSession ? (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <div className="spinner" style={{ width: '32px', height: '32px', border: '3px solid var(--color-slate-100)', borderTopColor: 'var(--color-primary-600)', borderRadius: '50%', margin: '0 auto 1rem', animation: 'spin 1s linear infinite' }}></div>
                  <p style={{ color: 'var(--color-slate-500)', fontSize: '0.875rem' }}>Verificando estado de la caja...</p>
                </div>
              ) : currentSession ? (
                <div style={{ background: 'var(--color-success-50)', border: '1px solid var(--color-success-200)', borderRadius: '1rem', padding: '2rem', textAlign: 'center' }}>
                  <div style={{ width: '48px', height: '48px', background: 'var(--color-success-100)', color: 'var(--color-success-600)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-success-900)', margin: '0 0 0.5rem 0' }}>Caja Abierta</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-success-700)', margin: '0 0 2rem 0' }}>
                    Iniciada el {new Date(currentSession.opened_at).toLocaleString('es-CO')}
                  </p>
                  <button
                    onClick={handleContinue}
                    style={{ width: '100%', padding: '1rem', background: 'var(--color-success-600)', color: '#fff', border: 'none', borderRadius: '1rem', fontWeight: 600, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(22, 163, 74, 0.2)' }}
                  >
                    Continuar al Punto de Venta
                  </button>
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid var(--color-slate-200)', borderRadius: '1rem', padding: 'clamp(1.5rem, 5vw, 2rem)' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)', margin: '0 0 1.5rem 0' }}>Apertura de Caja</h3>
                  
                  <div style={{ marginBottom: '2rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)', marginBottom: '0.5rem' }}>
                      Monto Inicial (Base en COP)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-slate-500)', fontWeight: 600 }}>$</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={openingAmountPesos}
                        onChange={(event) => setOpeningAmountPesos(Number(event.target.value))}
                        style={{ width: '100%', padding: '1rem 1rem 1rem 2.5rem', borderRadius: '0.75rem', border: '2px solid var(--color-primary-100)', background: 'var(--color-primary-50)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary-900)' }}
                      />
                    </div>
                    <p style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', marginTop: '0.75rem' }}>
                      Sugerido: <strong>{formatMoneyFromCents(openingAmountPesos * 100)}</strong>
                    </p>
                  </div>

                  <button
                    disabled={opening}
                    onClick={() => void handleOpenCashSession()}
                    style={{ width: '100%', padding: '1rem', background: 'var(--color-primary-600)', color: '#fff', border: 'none', borderRadius: '1rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)', transition: 'transform 0.2s' }}
                    onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
                    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {opening ? 'Abriendo caja...' : 'Abrir Caja y Comenzar'}
                  </button>
                </div>
              )}
            </div>
          )}

        </section>
      </main>

      {/* Global CSS for animations */}
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
