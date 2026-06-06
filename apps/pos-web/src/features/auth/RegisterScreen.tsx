import { useState, useEffect } from 'react';
import { Banner } from '../../components/ui';
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
  });

  const [plans, setPlans] = useState<{ id: string; name: string; priceCents: number }[]>([]);
  
  useEffect(() => {
    void api.getBillingPlans().then(res => setPlans(res.plans)).catch(() => {
      setPlans([
        { id: 'STARTER', name: 'Starter', priceCents: 0 },
        { id: 'BASIC', name: 'Pro', priceCents: 5000000 },
        { id: 'PRO', name: 'Enterprise', priceCents: 15000000 }
      ]);
    });
  }, [api]);

  async function handleFinalSubmit() {
    setLoading(true);
    setError(null);
    setSimulationState(1);

    try {
      // Simulate onboarding progress steps visually
      setTimeout(() => setSimulationState(2), 1500);
      setTimeout(() => setSimulationState(3), 3000);
      
      await api.register(formData);
      
      setSimulationState(4);
      setTimeout(async () => {
        await login({ email: formData.email, password: formData.password });
      }, 1000);
      
    } catch (err: any) {
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
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-slate-50)', fontFamily: 'var(--font-sans)' }}>
        <div style={{ background: '#fff', padding: '3rem', borderRadius: '1.5rem', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-slate-100)', width: '100%', maxWidth: '400px' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid var(--color-primary-100)', borderTopColor: 'var(--color-primary-600)', borderRadius: '50%', margin: '0 auto 1rem', animation: 'spin 1s linear infinite' }}></div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Configurando tu entorno</h2>
            <p style={{ color: 'var(--color-slate-500)', fontSize: '0.875rem' }}>Estamos preparando todo para ti...</p>
          </div>
          
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: simulationState >= 1 ? 'var(--color-slate-900)' : 'var(--color-slate-400)', opacity: simulationState >= 1 ? 1 : 0.5, transition: 'all 0.3s' }}>
              <CheckCircle active={simulationState >= 2} /> Creando organización
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: simulationState >= 2 ? 'var(--color-slate-900)' : 'var(--color-slate-400)', opacity: simulationState >= 2 ? 1 : 0.5, transition: 'all 0.3s' }}>
              <CheckCircle active={simulationState >= 3} /> Configurando sucursal
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: simulationState >= 3 ? 'var(--color-slate-900)' : 'var(--color-slate-400)', opacity: simulationState >= 3 ? 1 : 0.5, transition: 'all 0.3s' }}>
              <CheckCircle active={simulationState >= 4} /> Preparando caja registradora
            </li>
          </ul>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-slate-50)', padding: '1.5rem', fontFamily: 'var(--font-sans)' }}>
      <section style={{ width: '100%', maxWidth: step === 3 ? '800px' : '480px', background: '#ffffff', padding: '2.5rem', borderRadius: '1.5rem', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-slate-100)', transition: 'all 0.3s ease-in-out' }}>
        
        {/* Wizard Header */}
        <header style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <button type="button" onClick={step === 1 ? onBack : () => setStep(step - 1)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--color-slate-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
              &larr; Volver
            </button>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-primary-600)', background: 'var(--color-primary-50)', padding: '0.25rem 0.75rem', borderRadius: '1rem' }}>
              Paso {step} de 3
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
            <div style={{ flex: 1, height: '4px', background: step >= 1 ? 'var(--color-primary-600)' : 'var(--color-slate-200)', borderRadius: '2px', transition: 'background 0.3s' }} />
            <div style={{ flex: 1, height: '4px', background: step >= 2 ? 'var(--color-primary-600)' : 'var(--color-slate-200)', borderRadius: '2px', transition: 'background 0.3s' }} />
            <div style={{ flex: 1, height: '4px', background: step >= 3 ? 'var(--color-primary-600)' : 'var(--color-slate-200)', borderRadius: '2px', transition: 'background 0.3s' }} />
          </div>

          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem' }}>
            {step === 1 && 'Crea tu cuenta de usuario'}
            {step === 2 && 'Datos de tu negocio'}
            {step === 3 && 'Selecciona un plan'}
          </h1>
          <p style={{ color: 'var(--color-slate-500)', fontSize: '0.9375rem' }}>
            {step === 1 && 'Ingresa tus datos personales para acceder a la plataforma.'}
            {step === 2 && 'Esta información aparecerá en tus facturas electrónicas.'}
            {step === 3 && 'Puedes cambiar de plan más adelante.'}
          </p>
        </header>

        {error && (
          <div style={{ marginBottom: '1.5rem' }}>
            <Banner tone="error">{error}</Banner>
          </div>
        )}

        <form onSubmit={nextStep} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.3s ease-in-out' }}>
              <div className="input-group">
                <label style={labelStyle}>Nombre Completo</label>
                <input required type="text" name="name" value={formData.name} onChange={handleChange} autoComplete="name" className="input" placeholder="Ej. Ana Pérez" style={inputStyle} />
              </div>
              <div className="input-group">
                <label style={labelStyle}>Correo Electrónico</label>
                <input required type="email" name="email" value={formData.email} onChange={handleChange} autoComplete="email" className="input" placeholder="correo@ejemplo.com" style={inputStyle} />
              </div>
              <div className="input-group">
                <label style={labelStyle}>Contraseña</label>
                <input required type="password" name="password" value={formData.password} onChange={handleChange} autoComplete="new-password" className="input" placeholder="••••••••" minLength={8} style={inputStyle} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.3s ease-in-out' }}>
              <div className="input-group">
                <label style={labelStyle}>Nombre del Negocio (Corto)</label>
                <input required type="text" name="tenant_name" value={formData.tenant_name} onChange={handleChange} className="input" placeholder="Ej. Mi Tienda" style={inputStyle} />
              </div>
              <div className="input-group">
                <label style={labelStyle}>Razón Social</label>
                <input required type="text" name="tenant_business_name" value={formData.tenant_business_name} onChange={handleChange} className="input" placeholder="Ej. Mi Tienda S.A.S." style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                <div className="input-group">
                  <label style={labelStyle}>Tipo Doc.</label>
                  <select required name="tenant_document_type" value={formData.tenant_document_type} onChange={handleChange} className="input" style={inputStyle}>
                    <option value="NIT">NIT</option>
                    <option value="CC">CC</option>
                    <option value="CE">CE</option>
                  </select>
                </div>
                <div className="input-group">
                  <label style={labelStyle}>Número de Documento</label>
                  <input required type="text" name="tenant_document_number" value={formData.tenant_document_number} onChange={handleChange} className="input" placeholder="Ej. 900123456" style={inputStyle} />
                </div>
              </div>
              <div className="input-group">
                <label style={labelStyle}>Régimen Tributario</label>
                <select required name="tax_mode" value={formData.tax_mode} onChange={handleChange} className="input" style={inputStyle}>
                  <option value="IVA">Responsable de IVA</option>
                  <option value="INC_RESTAURANT">Impoconsumo Restaurantes</option>
                  <option value="NO_RESPONSIBLE">No responsable de IVA</option>
                </select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                {plans.map(p => {
                  const isSelected = formData.plan === p.id;
                  return (
                    <div 
                      key={p.id} 
                      onClick={() => setFormData(prev => ({ ...prev, plan: p.id }))}
                      style={{ 
                        border: isSelected ? '2px solid var(--color-primary-600)' : '1px solid var(--color-slate-200)',
                        background: isSelected ? 'var(--color-primary-50)' : '#fff',
                        borderRadius: '1rem',
                        padding: '1.5rem',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: isSelected ? '0 4px 12px rgba(79, 70, 229, 0.15)' : 'none',
                        position: 'relative'
                      }}
                    >
                      {isSelected && (
                        <div style={{ position: 'absolute', top: '-10px', right: '15px', background: 'var(--color-primary-600)', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '0.25rem 0.5rem', borderRadius: '1rem', textTransform: 'uppercase' }}>
                          Seleccionado
                        </div>
                      )}
                      <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-slate-900)', marginBottom: '0.25rem' }}>{p.name}</h3>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '1rem' }}>
                        ${(p.priceCents / 100).toLocaleString('es-CO')}
                        <span style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', fontWeight: 400 }}>/mes</span>
                      </div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem', color: 'var(--color-slate-600)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <li>✓ Usuarios {p.id === 'STARTER' ? 'limitados' : 'ilimitados'}</li>
                        <li>✓ Facturación {p.id === 'STARTER' ? 'básica' : 'avanzada'}</li>
                        <li>✓ Soporte {p.id === 'PRO' ? 'prioritario 24/7' : 'estándar'}</li>
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ marginTop: '1rem' }}>
            <button type="submit" disabled={loading} style={{ 
              width: '100%', 
              padding: '1rem', 
              background: 'var(--color-primary-600)', 
              color: '#ffffff', 
              border: 'none', 
              borderRadius: '1rem', 
              fontSize: '1rem', 
              fontWeight: 600, 
              cursor: 'pointer',
              boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.3)',
              transition: 'all 0.2s'
            }}>
              {step === 3 ? 'Comenzar a usar POS Cloud' : 'Continuar'}
            </button>
          </div>

        </form>
      </section>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </main>
  );
}

const labelStyle = { display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-slate-700)' };
const inputStyle = { width: '100%', padding: '0.875rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--color-slate-300)', background: '#fff', fontSize: '1rem', transition: 'border-color 0.2s, box-shadow 0.2s' };

const CheckCircle = ({ active }: { active: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'var(--color-success-600)' : 'none'} stroke={active ? 'var(--color-success-600)' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'all 0.3s' }}>
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
