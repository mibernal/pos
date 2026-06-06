import { useState } from 'react';
import { Banner, Button, Card } from '../../components/ui';
import { LoginForm } from './components/LoginForm';
import { useSession } from './context/SessionProvider';
import { RegisterScreen } from './RegisterScreen';

const ChartIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"></line>
    <line x1="12" y1="20" x2="12" y2="4"></line>
    <line x1="6" y1="20" x2="6" y2="14"></line>
  </svg>
);

const InvoiceIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" y1="13" x2="8" y2="13"></line>
    <line x1="16" y1="17" x2="8" y2="17"></line>
    <polyline points="10 9 9 9 8 9"></polyline>
  </svg>
);

export function LoginScreen() {
  const { authMessage, clearAuthMessage, login, logout, api } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<{ id: string; name: string; business_name: string }[] | null>(null);
  const [pendingCredentials, setPendingCredentials] = useState<{ email: string; password: string } | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);

  async function handleSubmit(input: { email: string; password: string }, tenantId?: string) {
    setLoading(true);
    setError(null);
    clearAuthMessage();

    try {
      await login({ ...input, tenantId });
      setTenantOptions(null);
      setPendingCredentials(null);
    } catch (err: unknown) {
      const authErr = err as { requireTenantSelection?: boolean; tenants?: { id: string; name: string; business_name: string }[] } | null;
      if (authErr && authErr.requireTenantSelection && authErr.tenants) {
        setTenantOptions(authErr.tenants);
        setPendingCredentials(input);
      } else {
        setError(err instanceof Error ? err.message : 'No fue posible iniciar sesión');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSelectTenant(tenantId: string) {
    if (pendingCredentials) {
      void handleSubmit(pendingCredentials, tenantId);
    }
  }

  if (isRegistering) {
    return (
      <RegisterScreen 
        api={api}
        login={login}
        onBack={() => setIsRegistering(false)} 
      />
    );
  }

  return (
    <>
      <main className="min-h-screen grid grid-cols-1 md:grid-cols-2 bg-background font-sans">
        
        {/* Left Column: Hero Section */}
        <section className="relative flex flex-col justify-center items-center overflow-hidden p-8 md:p-16 text-primary-foreground bg-primary/95 min-h-[40vh]">
          
          {/* Subtle mesh gradient background effect */}
          <div className="absolute -top-[10%] -left-[10%] w-[400px] h-[400px] bg-white/10 blur-[100px] rounded-full"></div>
          <div className="absolute -bottom-[10%] -right-[10%] w-[300px] h-[300px] bg-black/10 blur-[80px] rounded-full"></div>

          <div className="z-10 max-w-lg w-full">
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight mb-6">
              Gestiona ventas, inventario y facturación desde una sola plataforma.
            </h1>
            <p className="text-lg text-primary-foreground/80 font-normal mb-12">
              Más de 5,000 negocios digitalizan sus operaciones con POS Cloud. Rápido, seguro y siempre disponible.
            </p>

            {/* Floating Glass Cards Grid */}
            <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-primary-foreground/90"><ChartIcon /></div>
                  <span className="text-sm font-semibold text-primary-foreground/70">Ventas Hoy</span>
                </div>
                <div className="text-2xl font-bold mb-1">$2.4M</div>
                <div className="text-xs font-medium text-green-300">+14.5% vs ayer</div>
              </div>

              <div className="bg-white/10 backdrop-blur-md border border-white/20 p-6 rounded-2xl shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="text-primary-foreground/90"><InvoiceIcon /></div>
                  <span className="text-sm font-semibold text-primary-foreground/70">Facturas DIAN</span>
                </div>
                <div className="text-2xl font-bold mb-1">142</div>
                <div className="text-xs font-medium text-primary-foreground/50">Procesadas con éxito</div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Column: Auth Form */}
        <section className="flex justify-center items-center p-8 bg-card">
          <div className="w-full max-w-[400px]">
            <header className="mb-10">
              <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-primary-foreground text-xl font-bold mb-6 shadow-md shadow-primary/20">
                P
              </div>
              <h1 className="text-3xl font-extrabold text-foreground mb-2 tracking-tight">Inicia sesión</h1>
              <p className="text-muted-foreground">Ingresa tus credenciales para acceder a tu panel.</p>
            </header>

            {authMessage && (
              <div className="mb-6">
                <Banner tone="success" onClose={clearAuthMessage}>{authMessage}</Banner>
              </div>
            )}
            
            {error && (
              <div className="mb-6">
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            <LoginForm onSubmit={(creds) => handleSubmit(creds)} loading={loading} />

            <div className="mt-8 text-center text-sm text-muted-foreground">
              ¿No tienes una cuenta? <button onClick={() => setIsRegistering(true)} className="text-primary font-semibold hover:underline bg-transparent border-none p-0 cursor-pointer">Regístrate aquí</button>
            </div>
          </div>
        </section>
      </main>

      {/* Modern Tenant Selection Modal */}
      {tenantOptions && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <Card className="w-full max-w-[440px] p-8 border-border bg-card shadow-2xl">
            <header className="mb-8 text-center">
              <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mx-auto mb-4 text-xl">
                🏢
              </div>
              <h2 className="text-2xl font-bold text-foreground">Selecciona una Empresa</h2>
              <p className="text-sm text-muted-foreground mt-2">Tienes acceso a múltiples organizaciones.</p>
            </header>
            
            <div className="grid gap-3 max-h-[300px] overflow-y-auto">
              {tenantOptions.map((tenant, idx) => (
                <button
                  key={tenant.id || `tenant-${idx}`}
                  onClick={() => handleSelectTenant(tenant.id)}
                  disabled={loading}
                  className="w-full flex items-center justify-between p-5 text-left bg-background border border-border rounded-2xl cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <div>
                    <strong className="block text-base text-foreground font-semibold group-hover:text-primary transition-colors">{tenant.name}</strong>
                    <span className="text-sm text-muted-foreground">{tenant.business_name}</span>
                  </div>
                  <div className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </button>
              ))}
            </div>
            
            <div className="mt-8 flex flex-col gap-3">
              <Button
                variant="outline"
                size="lg"
                onClick={() => { setTenantOptions(null); setPendingCredentials(null); }}
                className="w-full rounded-xl"
              >
                Volver
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setTenantOptions(null);
                  setPendingCredentials(null);
                  logout();
                }}
                className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl"
              >
                Cerrar Sesión
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
