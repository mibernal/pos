import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, ShellMessage, Button, Card, Input } from '../../components/ui'; // eslint-disable-line @typescript-eslint/no-unused-vars
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
    OPEN: { color: 'bg-green-500', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', label: 'Abierta' },
    CLOSED: { color: 'bg-slate-400', text: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800', label: 'Cerrada' },
    ISSUE: { color: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-900/20', label: 'Incidencia' },
  };
  
  const current = statusConfig[status];

  return (
    <button 
      onClick={onClick}
      className={`group relative w-full flex flex-col p-5 text-left bg-card rounded-2xl border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${
        selected 
          ? 'border-primary ring-2 ring-primary/20 shadow-md bg-primary/5' 
          : 'border-border hover:border-primary/50 hover:shadow-md'
      }`}
    >
      <div className="flex justify-between items-start w-full mb-4">
        <div className={`p-2 rounded-lg ${selected ? 'bg-background' : 'bg-muted'}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
             <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
             <line x1="8" y1="21" x2="16" y2="21"></line>
             <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${current.bg} ${current.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${current.color}`}></span>
          {current.label}
        </span>
      </div>
      
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground mb-1">{name}</h3>
        <p className="text-xs text-muted-foreground m-0">ID: {lastActivity}</p>
      </div>
      
      {currentUser ? (
        <div className="mt-auto pt-4 border-t border-border flex items-center gap-2 w-full">
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
            {currentUser.charAt(0).toUpperCase()}
          </div>
          <span className="text-xs text-muted-foreground font-medium">{currentUser}</span>
        </div>
      ) : (
        <div className="mt-auto pt-4 border-t border-border w-full">
          <span className="text-xs text-muted-foreground/60">Sin operador</span>
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
  }, [api, session]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="min-h-screen flex flex-col bg-muted/20 font-sans">
      <header className="px-6 py-4 flex justify-between items-center bg-background border-b border-border shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground text-base font-bold shadow-sm">
            P
          </div>
          <span className="text-base font-bold text-foreground tracking-tight">POS Cloud</span>
        </div>
        <button 
          onClick={logout}
          className="text-sm font-semibold text-destructive hover:bg-destructive/10 px-4 py-2 rounded-lg transition-colors"
        >
          Cerrar Sesión
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 bg-muted/10">
        <section className={`w-full bg-card p-8 md:p-12 rounded-3xl shadow-lg border border-border transition-all duration-500 relative animate-in fade-in zoom-in-95 ${step === 1 ? 'max-w-4xl' : 'max-w-2xl'}`}>
          
          <header className="mb-10 text-center">
            {step > 1 && (
              <button 
                onClick={() => setStep(step === 3 ? 2 : 1)} 
                className="absolute top-6 left-6 bg-muted hover:bg-muted/80 text-foreground px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2"
              >
                <span>&larr;</span> Atrás
              </button>
            )}
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {step === 1 ? <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path> : <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>}
              </svg>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground mb-2 tracking-tight">
              {step === 1 ? 'Selecciona una Sucursal' : step === 2 ? 'Selecciona una Caja' : 'Estado de la Caja'}
            </h1>
            <p className="text-base text-muted-foreground">
              {step === 1 ? '¿Desde dónde vas a operar hoy?' : step === 2 ? `Sucursal ${selectedBranch?.name}` : `Terminal ${selectedTerminal?.name}`}
            </p>
          </header>

          {error && (
            <div className="mb-8">
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          {step === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">
              {branches.map(branch => (
                <button
                  key={branch.id}
                  onClick={() => handleSelectBranch(branch.id)}
                  className="p-6 bg-background border border-border rounded-2xl text-left cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group flex flex-col h-full"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 bg-muted rounded-xl group-hover:bg-primary/10 group-hover:text-primary transition-colors text-lg">🏢</div>
                    <h3 className="text-lg font-bold text-foreground leading-tight">{branch.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6 flex-1">{branch.address}</p>
                  <div className="text-sm font-semibold text-primary flex items-center justify-between w-full mt-auto">
                    <span>Seleccionar sucursal</span>
                    <span className="transform transition-transform group-hover:translate-x-1">&rarr;</span>
                  </div>
                </button>
              ))}
              {branches.length === 0 && !loading && (
                <div className="col-span-full">
                  <Banner tone="warning">No tienes sucursales asignadas. Contacta al administrador.</Banner>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="animate-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {terminals.map(terminal => (
                  <TerminalCard
                    key={terminal.id}
                    name={terminal.name}
                    status={terminal.is_active ? 'OPEN' : 'CLOSED'}
                    lastActivity={terminal.id.substring(0, 8)}
                    onClick={() => {
                      setSelectedTerminalId(terminal.id);
                      setStep(3);
                    }}
                  />
                ))}
              </div>

              {(session?.user?.role === 'ADMIN' || session?.user?.role === 'TENANT_OWNER') && (
                <div className="mt-8 pt-8 border-t border-dashed border-border">
                  {isCreatingTerminal ? (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Input
                        value={newTerminalName}
                        onChange={(e) => setNewTerminalName(e.target.value)}
                        placeholder="Nombre de la nueva caja (Ej. Caja Principal)"
                        className="flex-1 h-12"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => void handleCreateTerminal()}
                          disabled={!newTerminalName.trim()}
                          className="h-12 px-6"
                        >
                          Guardar
                        </Button>
                        <Button variant="ghost" className="h-12 px-4" onClick={() => setIsCreatingTerminal(false)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setIsCreatingTerminal(true)} 
                      className="w-full p-5 border-2 border-dashed border-border rounded-2xl bg-muted/30 text-muted-foreground font-semibold cursor-pointer transition-all hover:border-primary/50 hover:text-primary hover:bg-primary/5 flex flex-col items-center justify-center gap-2"
                    >
                      <span className="text-2xl leading-none">+</span>
                      <span>Crear nueva caja registradora</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              {checkingSession ? (
                <div className="text-center py-12">
                  <div className="w-10 h-10 border-4 border-muted border-t-primary rounded-full mx-auto mb-6 animate-spin"></div>
                  <p className="text-base font-medium text-muted-foreground">Verificando estado de la caja...</p>
                </div>
              ) : currentSession ? (
                <div className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-900/30 rounded-2xl p-8 text-center shadow-sm">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-800/40 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  </div>
                  <h3 className="text-2xl font-bold text-green-900 dark:text-green-400 mb-2">Caja Abierta</h3>
                  <p className="text-base text-green-700 dark:text-green-500 mb-8">
                    Iniciada el {new Date(currentSession.opened_at).toLocaleString('es-CO')}
                  </p>
                  {session?.user?.role === 'CASHIER' && currentSession.opened_by_user_id !== session?.user?.id ? (
                    <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 text-sm mb-4">
                      <strong>Caja bloqueada:</strong> Esta caja fue abierta por otro cajero. Pídele al administrador que la cierre, o inicia sesión con el usuario original.
                    </div>
                  ) : (
                    <Button
                      onClick={handleContinue}
                      className="w-full text-lg py-7 shadow-xl shadow-green-600/10 bg-green-600 hover:bg-green-700 text-white border-0"
                    >
                      Continuar al Punto de Venta
                    </Button>
                  )}
                </div>
              ) : (
                <div className="bg-background border border-border rounded-2xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full -mr-16 -mt-16 pointer-events-none"></div>
                  
                  <h3 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
                    <span className="text-primary">✨</span>
                    Apertura de Caja
                  </h3>
                  
                  <div className="mb-8">
                    <label className="block text-sm font-semibold text-foreground mb-2">
                      Monto Inicial (Base en COP)
                    </label>
                    <div className="relative group">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-lg pointer-events-none group-focus-within:text-primary transition-colors">$</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={openingAmountPesos}
                        onChange={(event) => setOpeningAmountPesos(Number(event.target.value))}
                        className="w-full py-5 pr-5 pl-12 rounded-xl border-2 border-border bg-muted/30 text-2xl font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all focus:bg-background"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-sm text-muted-foreground">
                        Sugerido: <strong>{formatMoneyFromCents(openingAmountPesos * 100)}</strong>
                      </p>
                    </div>
                  </div>

                  <Button
                    disabled={opening}
                    onClick={() => void handleOpenCashSession()}
                    className="w-full text-lg py-7 shadow-xl shadow-primary/20 active:scale-[0.98] transition-all bg-primary hover:bg-primary/90 text-primary-foreground font-bold border-0"
                  >
                    {opening ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        Abriendo caja...
                      </span>
                    ) : 'Abrir Caja y Comenzar'}
                  </Button>
                </div>
              )}
            </div>
          )}

        </section>
      </main>
    </div>
  );
}
