import React, { useState, useEffect } from 'react';

interface PlansManagementTabProps {
  api: any;
}

export function PlansManagementTab({ api }: PlansManagementTabProps) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPlans();
  }, []);

  async function loadPlans() {
    try {
      setLoading(true);
      const res = await api.getPlatformPlans();
      setPlans(res.plans || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar los planes');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando planes...</div>;

  return (
    <div style={{ background: '#ffffff', borderRadius: '1.25rem', border: '1px solid var(--color-slate-200)', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--color-slate-100)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>Planes de Suscripción</h2>
        <button style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none', backgroundColor: 'var(--color-primary-600)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
          + Crear Plan
        </button>
      </div>

      {error && <div style={{ padding: '1rem', background: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>{error}</div>}

      <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {plans.map(plan => (
          <div key={plan.id} style={{ border: '1px solid var(--color-slate-200)', borderRadius: '1rem', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-slate-900)' }}>{plan.name}</h3>
              <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 600, backgroundColor: plan.active ? 'var(--color-success-100)' : 'var(--color-slate-100)', color: plan.active ? 'var(--color-success-700)' : 'var(--color-slate-700)' }}>
                {plan.active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-slate-900)', marginBottom: '0.5rem' }}>
              {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(plan.price_cents / 100)}
              <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--color-slate-500)' }}>/{plan.billing_cycle === 'MONTHLY' ? 'mes' : 'año'}</span>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
              <button style={{ flex: 1, padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)', backgroundColor: 'transparent', fontWeight: 600, cursor: 'pointer' }}>Editar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
