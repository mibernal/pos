import { useState, useEffect } from 'react';
import { Banner, Button, Card, Input, Label, BusinessTypeSelector } from '../../components/ui';
import type { PosApiClient } from '../../types';

interface RegisterScreenProps {
  api: PosApiClient;
  login: (input: { email: string; password: string }) => Promise<void>;
  onBack: () => void;
}

export function RegisterScreen({ api, login, onBack }: RegisterScreenProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationState, setSimulationState] = useState(0); // 0: inactive, 1: org, 2: branch, 3: pos, 4: done

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    tenant_name: '',
    tenant_business_name: '',
    tenant_document_type: 'NIT',
    tenant_document_number: '',
    tax_mode: 'IVA',
    plan: 'STARTER',
    business_type: 'OTHER',
    custom_business_type: '',
    modules: {
      enable_tables: false,
      enable_delivery: false,
      enable_waiters: false,
      enable_split_bill: false,
      enable_tips: false,
      enable_kitchen: false,
      enable_kitchen_display: false,
      enable_kitchen_tickets: false,
      enable_kitchen_printing: false,
      enable_order_rounds: false,
      enable_product_modifiers: false,
      enable_reservations: false,
      enable_waiter_shifts: false,
      enable_qr_menu: false,
      enable_guests_count: false,
      enable_restaurant: false,
      enable_kds: false,
      enable_inventory: false,
      enable_fiscal: false,
      enable_loyalty: false,
      enable_advanced_reports: false
    }
  });

  const [plans, setPlans] = useState<{ id: string; name: string; price_cents: number }[]>([]);

  useEffect(() => {
    void api.getBillingPlans().then(res => setPlans(res.plans)).catch(() => {
      setPlans([
        { id: 'STARTER', name: 'Starter', price_cents: 0 },
        { id: 'BASIC', name: 'Pro', price_cents: 5000000 },
        { id: 'PRO', name: 'Enterprise', price_cents: 15000000 }
      ]);
    });
  }, [api]);

  async function handleFinalSubmit() {
    setLoading(true);
    setError(null);
    setSimulationState(1);

    try {
      setTimeout(() => setSimulationState(2), 1500);
      setTimeout(() => setSimulationState(3), 3000);

      const payload = { 
        ...formData,
        ...(formData.business_type === 'OTHER' ? formData.modules : {})
      };
      if (payload.business_type !== 'OTHER' || !payload.custom_business_type) {
        delete (payload as any).custom_business_type;
      }
      delete (payload as any).modules;

      await api.register(payload);

      setSimulationState(4);
      setTimeout(async () => {
        await login({ email: formData.email, password: formData.password });
      }, 1000);

    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al crear la cuenta. Por favor verifica los datos.');
      setSimulationState(0);
      setLoading(false);
    }
  }

  function nextStep(e: React.FormEvent) {
    e.preventDefault();
    if (step < 3) setStep(step + 1);
    else handleFinalSubmit();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  if (simulationState > 0) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background font-sans p-6">
        <Card className="w-full max-w-md p-10 flex flex-col items-center shadow-lg border-border">
          <div className="text-center mb-8">
            <div className="w-12 h-12 border-4 border-muted border-t-primary rounded-full mx-auto mb-4 animate-spin"></div>
            <h2 className="text-xl font-bold text-foreground">Configurando tu entorno</h2>
            <p className="text-muted-foreground text-sm mt-1">Estamos preparando todo para ti...</p>
          </div>

          <ul className="w-full flex flex-col gap-4">
            <li className={`flex items-center gap-3 transition-all duration-300 ${simulationState >= 1 ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-50'}`}>
              <CheckCircle active={simulationState >= 2} /> Creando organización
            </li>
            <li className={`flex items-center gap-3 transition-all duration-300 ${simulationState >= 2 ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-50'}`}>
              <CheckCircle active={simulationState >= 3} /> Configurando sucursal
            </li>
            <li className={`flex items-center gap-3 transition-all duration-300 ${simulationState >= 3 ? 'text-foreground opacity-100' : 'text-muted-foreground opacity-50'}`}>
              <CheckCircle active={simulationState >= 4} /> Preparando caja registradora
            </li>
          </ul>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/20 p-6 font-sans">
      <Card className={`w-full ${step === 3 ? 'max-w-4xl' : 'max-w-lg'} p-8 sm:p-10 transition-all duration-500 shadow-xl border-border bg-card`}>

        {/* Wizard Header */}
        <header className="mb-10">
          <div className="flex justify-between items-center mb-6">
            <button
              type="button"
              onClick={step === 1 ? onBack : () => setStep(step - 1)}
              className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 font-medium transition-colors"
            >
              &larr; Volver
            </button>
            <div className="text-sm font-semibold text-primary bg-primary/10 px-3 py-1 rounded-full">
              Paso {step} de 3
            </div>
          </div>

          <div className="flex gap-2 mb-8">
            <div className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${step >= 1 ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${step >= 2 ? 'bg-primary' : 'bg-muted'}`} />
            <div className={`flex-1 h-1.5 rounded-full transition-colors duration-300 ${step >= 3 ? 'bg-primary' : 'bg-muted'}`} />
          </div>

          <h1 className="text-3xl font-extrabold text-foreground mb-2 tracking-tight">
            {step === 1 && 'Crea tu cuenta de usuario'}
            {step === 2 && 'Datos de tu negocio'}
            {step === 3 && 'Selecciona un plan'}
          </h1>
          <p className="text-muted-foreground text-base">
            {step === 1 && 'Ingresa tus datos personales para acceder a la plataforma.'}
            {step === 2 && 'Esta información aparecerá en tus facturas electrónicas.'}
            {step === 3 && 'Puedes cambiar de plan más adelante.'}
          </p>
        </header>

        {error && (
          <div className="mb-6">
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <form onSubmit={nextStep} className="flex flex-col gap-6">

          {step === 1 && (
            <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid gap-2">
                <Label htmlFor="name">Nombre Completo</Label>
                <Input required type="text" id="name" name="name" value={formData.name} onChange={handleChange} autoComplete="name" placeholder="Ej. Ana Pérez" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input required type="email" id="email" name="email" value={formData.email} onChange={handleChange} autoComplete="email" placeholder="correo@ejemplo.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input required type="password" id="password" name="password" value={formData.password} onChange={handleChange} autoComplete="new-password" placeholder="••••••••" minLength={8} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid gap-2">
                <Label htmlFor="tenant_name">Nombre del Negocio (Corto)</Label>
                <Input required type="text" id="tenant_name" name="tenant_name" value={formData.tenant_name} onChange={handleChange} placeholder="Ej. Mi Tienda" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tenant_business_name">Razón Social</Label>
                <Input required type="text" id="tenant_business_name" name="tenant_business_name" value={formData.tenant_business_name} onChange={handleChange} placeholder="Ej. Mi Tienda S.A.S." />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="grid gap-2 sm:col-span-1">
                  <Label htmlFor="tenant_document_type">Tipo Doc.</Label>
                  <select required id="tenant_document_type" name="tenant_document_type" value={formData.tenant_document_type} onChange={handleChange} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <option value="NIT">NIT</option>
                    <option value="CC">CC</option>
                    <option value="CE">CE</option>
                  </select>
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="tenant_document_number">Número de Documento</Label>
                  <Input required type="text" id="tenant_document_number" name="tenant_document_number" value={formData.tenant_document_number} onChange={handleChange} placeholder="Ej. 900123456" />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tax_mode">Régimen Tributario</Label>
                <select required id="tax_mode" name="tax_mode" value={formData.tax_mode} onChange={handleChange} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="IVA">Responsable de IVA</option>
                  <option value="INC_RESTAURANT">Impoconsumo Restaurantes</option>
                  <option value="NO_RESPONSIBLE">No responsable de IVA</option>
                </select>
              </div>
              <div className="pt-4 border-t border-border">
                <BusinessTypeSelector
                  value={formData.business_type as any}
                  onChange={(v) => setFormData(prev => ({ ...prev, business_type: v }))}
                  customValue={formData.custom_business_type}
                  onCustomValueChange={(v) => setFormData(prev => ({ ...prev, custom_business_type: v }))}
                  modules={formData.modules}
                  onModulesChange={(v) => setFormData(prev => ({ ...prev, modules: v }))}
                  layout="grid"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                {plans.map(p => {
                  const isSelected = formData.plan === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setFormData(prev => ({ ...prev, plan: p.id }))}
                      className={`relative p-6 rounded-2xl cursor-pointer transition-all duration-200 border-2 ${isSelected ? 'border-primary bg-primary/5 shadow-md' : 'border-border bg-card hover:border-primary/50 hover:shadow-sm'}`}
                    >
                      {isSelected && (
                        <div className="absolute -top-3 right-4 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide shadow-sm">
                          Seleccionado
                        </div>
                      )}
                      <h3 className="text-lg font-bold text-foreground mb-1">{p.name}</h3>
                      <div className="text-3xl font-extrabold text-foreground mb-4">
                        ${(p.price_cents / 100).toLocaleString('es-CO')}
                        <span className="text-sm text-muted-foreground font-normal">/mes</span>
                      </div>
                      <ul className="text-sm text-muted-foreground flex flex-col gap-2">
                        <li className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          Usuarios {p.id === 'STARTER' ? 'limitados' : 'ilimitados'}
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          Facturación {p.id === 'STARTER' ? 'básica' : 'avanzada'}
                        </li>
                        <li className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          Soporte {p.id === 'PRO' ? 'prioritario 24/7' : 'estándar'}
                        </li>
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-4">
            <Button type="submit" disabled={loading} size="lg" className="w-full text-base py-6">
              {step === 3 ? 'Comenzar a usar POS Cloud' : 'Continuar'}
            </Button>
          </div>

        </form>
      </Card>
    </main>
  );
}

const CheckCircle = ({ active }: { active: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke={active ? 'currentColor' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-all duration-300 ${active ? 'text-green-500' : 'text-muted'}`}>
    {active ? (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" stroke="#fff"></path>
        <polyline points="22 4 12 14.01 9 11.01" stroke="#fff"></polyline>
      </>
    ) : (
      <circle cx="12" cy="12" r="10"></circle>
    )}
  </svg>
);
