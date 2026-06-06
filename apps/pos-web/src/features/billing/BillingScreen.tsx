import { useState, useEffect } from 'react';

interface BillingScreenProps {
  api: ReturnType<typeof import('../../lib/api/client').createApiClient>;
  session: import('../../lib/api/client').AuthSession;
}

export function BillingScreen({ api, session }: BillingScreenProps) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<'WOMPI' | 'MERCADOPAGO'>('WOMPI');

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '16rem' }}>
        <div>Cargando planes...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', marginBottom: '0.5rem', textAlign: 'center' }}>Suscripción y Facturación</h1>
      <p style={{ color: '#6b7280', textAlign: 'center', marginBottom: '2rem' }}>
        Elige el plan que mejor se adapte a tu negocio.
      </p>

      {error && (
        <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '1rem', borderRadius: '0.5rem', marginBottom: '2rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginBottom: '3rem', alignItems: 'center' }}>
        <span style={{ fontWeight: 500 }}>Pasarela de pago:</span>
        <select 
          value={gateway}
          onChange={(e) => setGateway(e.target.value as any)}
          style={{ padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #d1d5db' }}
        >
          <option value="WOMPI">Wompi (Soporta PSE)</option>
          <option value="MERCADOPAGO">MercadoPago</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
        {plans.map((plan) => (
          <div key={plan.id} style={{ 
            backgroundColor: 'white', 
            borderRadius: '0.5rem', 
            padding: '2rem',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111827', marginBottom: '1rem' }}>{plan.name}</h3>
            <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '2.25rem', fontWeight: 800 }}>
                ${(plan.price_cents / 100).toLocaleString('es-CO')}
              </span>
              <span style={{ marginLeft: '0.5rem', color: '#6b7280' }}>/ mes</span>
            </div>
            
            <ul style={{ marginBottom: '2rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#10b981' }}>✓</span> 
                {plan.features_json.users === -1 ? 'Usuarios ilimitados' : `${plan.features_json.users} usuarios`}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#10b981' }}>✓</span> 
                {plan.features_json.branches === -1 ? 'Sucursales ilimitadas' : `${plan.features_json.branches} sucursales`}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#10b981' }}>✓</span> Facturación electrónica DIAN
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: '#10b981' }}>✓</span> Soporte técnico
              </li>
            </ul>

            <button 
              onClick={() => handleSubscribe(plan.id)}
              style={{
                width: '100%',
                backgroundColor: '#2563eb',
                color: 'white',
                padding: '0.75rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Seleccionar Plan
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
