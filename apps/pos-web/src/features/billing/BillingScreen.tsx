import { useState, useEffect } from 'react';

interface BillingScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
  session: import('../../lib/api/client').AuthSession;
}

export function BillingScreen({ api, session }: BillingScreenProps) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<'WOMPI' | 'MERCADOPAGO' | 'MOCK'>('MOCK');

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      setLoading(true);
      const data = await api.getBillingPlans();
      setPlans(data.plans || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(planId: string) {
    try {
      const result = await api.createCheckoutSession({
        planId,
        gateway,
        redirectUrl: window.location.href // Volver a esta misma página después del pago
      });

      // Redirigir al usuario al checkout de la pasarela
      window.location.href = result.checkoutUrl;
    } catch (err: any) {
      alert(err.message);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '60vh' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="spinner" style={{ width: '40px', height: '40px', border: '3px solid var(--color-primary-100)', borderTopColor: 'var(--color-primary-600)', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
          <p style={{ color: 'var(--color-slate-500)', fontWeight: 500 }}>Cargando planes disponibles...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Identify a 'recommended' plan (usually the middle one or 'PRO')
  const recommendedPlanName = 'PRO';

  return (
    <div style={{ padding: '3rem 2rem', maxWidth: '1280px', margin: '0 auto', fontFamily: 'var(--font-sans)' }}>
      {/* Header Section */}
      <header style={{ textAlign: 'center', marginBottom: '4rem', maxWidth: '600px', margin: '0 auto 4rem' }}>
        <div style={{ display: 'inline-block', padding: '0.25rem 1rem', background: 'var(--color-primary-50)', color: 'var(--color-primary-700)', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>
          Planes y Precios
        </div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--color-slate-900)', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: '1rem' }}>
          Escala tu negocio sin límites
        </h1>
        <p style={{ fontSize: '1.125rem', color: 'var(--color-slate-500)', lineHeight: 1.6 }}>
          Facturación electrónica, control de inventario y punto de venta unificado. Selecciona el plan que mejor se adapte al tamaño de tu operación.
        </p>
      </header>

      {error && (
        <div style={{ maxWidth: '800px', margin: '0 auto 2rem' }}>
          <div style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#b91c1c', padding: '1rem 1.5rem', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span style={{ fontWeight: 500 }}>{error}</span>
          </div>
        </div>
      )}

      {/* Gateway Selector (SaaS style toggle) */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '4rem' }}>
        <div style={{ background: 'var(--color-slate-100)', padding: '0.375rem', borderRadius: '1rem', display: 'flex', gap: '0.25rem' }}>
          {[
            { id: 'MOCK', label: 'Pruebas Locales' },
            { id: 'WOMPI', label: 'Wompi (PSE/TC)' },
            { id: 'MERCADOPAGO', label: 'MercadoPago' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setGateway(opt.id as any)}
              style={{
                padding: '0.5rem 1.25rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: gateway === opt.id ? '#ffffff' : 'transparent',
                color: gateway === opt.id ? 'var(--color-slate-900)' : 'var(--color-slate-500)',
                fontWeight: gateway === opt.id ? 600 : 500,
                fontSize: '0.875rem',
                boxShadow: gateway === opt.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bento Grid Pricing Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
        gap: '2rem',
        alignItems: 'stretch',
        maxWidth: '1100px',
        margin: '0 auto'
      }}>
        {plans.map((plan) => {
          const isRecommended = plan.name.toUpperCase().includes(recommendedPlanName) || plan.price_cents > 50000;
          
          return (
            <div key={plan.id} style={{ 
              position: 'relative',
              backgroundColor: isRecommended ? 'var(--color-slate-900)' : '#ffffff', 
              color: isRecommended ? '#ffffff' : 'var(--color-slate-900)',
              borderRadius: '1.5rem', 
              padding: '2.5rem 2rem',
              border: isRecommended ? '1px solid var(--color-slate-800)' : '1px solid var(--color-slate-200)',
              boxShadow: isRecommended 
                ? '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255,255,255,0.1)' 
                : '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              transform: isRecommended ? 'scale(1.02)' : 'scale(1)',
              zIndex: isRecommended ? 10 : 1,
              transition: 'transform 0.3s ease, box-shadow 0.3s ease'
            }}>
              {isRecommended && (
                <div style={{ 
                  position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)',
                  background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', color: 'white',
                  padding: '0.25rem 1rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                }}>
                  Más Popular
                </div>
              )}

              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: isRecommended ? 'rgba(255,255,255,0.9)' : 'var(--color-slate-600)' }}>{plan.name}</h3>
              
              <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '2rem' }}>
                <span style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                  ${(plan.price_cents / 100).toLocaleString('es-CO')}
                </span>
                <span style={{ marginLeft: '0.5rem', color: isRecommended ? 'rgba(255,255,255,0.6)' : 'var(--color-slate-500)', fontWeight: 500 }}>/ mes</span>
              </div>
              
              <button 
                onClick={() => handleSubscribe(plan.id)}
                style={{
                  width: '100%',
                  backgroundColor: isRecommended ? '#3b82f6' : 'var(--color-slate-100)',
                  color: isRecommended ? '#ffffff' : 'var(--color-slate-900)',
                  padding: '1rem',
                  borderRadius: '0.75rem',
                  fontWeight: 600,
                  fontSize: '1rem',
                  border: isRecommended ? 'none' : '1px solid var(--color-slate-200)',
                  cursor: 'pointer',
                  marginBottom: '2.5rem',
                  transition: 'all 0.2s ease',
                  boxShadow: isRecommended ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                }}
                onMouseOver={(e) => {
                  if(isRecommended) e.currentTarget.style.backgroundColor = '#2563eb';
                  else e.currentTarget.style.backgroundColor = 'var(--color-slate-200)';
                }}
                onMouseOut={(e) => {
                  if(isRecommended) e.currentTarget.style.backgroundColor = '#3b82f6';
                  else e.currentTarget.style.backgroundColor = 'var(--color-slate-100)';
                }}
              >
                Comenzar ahora
              </button>

              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem', color: isRecommended ? 'rgba(255,255,255,0.9)' : 'var(--color-slate-900)' }}>
                  ¿Qué incluye?
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '1rem', listStyle: 'none', padding: 0, margin: 0 }}>
                  {[
                    { text: plan.features_json.users === -1 ? 'Usuarios ilimitados' : `Hasta ${plan.features_json.users} usuarios` },
                    { text: plan.features_json.branches === -1 ? 'Sucursales ilimitadas' : `Hasta ${plan.features_json.branches} sucursales` },
                    { text: 'Facturación electrónica DIAN nativa' },
                    { text: 'Punto de Venta PWA Offline-first' },
                    { text: 'Gestión avanzada de inventario' },
                    { text: isRecommended ? 'Soporte prioritario 24/7' : 'Soporte vía email' }
                  ].map((feature, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', fontSize: '0.9375rem', color: isRecommended ? 'rgba(255,255,255,0.7)' : 'var(--color-slate-600)' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isRecommended ? '#60a5fa' : '#3b82f6'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      {feature.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
