import React, { useState, useEffect } from 'react';
import { Card, Button } from '../../../components/ui';

interface PlansManagementTabProps {
  api: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function PlansManagementTab({ api }: PlansManagementTabProps) {
  const [plans, setPlans] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPlans();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadPlans() {
    try {
      setLoading(true);
      const res = await api.getPlatformPlans();
      setPlans(res.plans || []);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al cargar los planes');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500 animate-pulse">
        Cargando planes de suscripción...
      </div>
    );
  }

  return (
    <Card className="flex flex-col">
      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white/50 rounded-t-2xl">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Planes de Suscripción</h2>
        <Button size="sm">
          + Crear Plan
        </Button>
      </div>

      {error && (
        <div className="m-6 p-4 bg-error-50 border border-error-100 text-error-700 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plans.map(plan => (
          <div key={plan.id} className="border border-slate-200 rounded-2xl p-6 flex flex-col bg-white shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                plan.active 
                  ? 'bg-success-100 text-success-700' 
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {plan.active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            
            <div className="mb-6">
              <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(plan.price_cents / 100)}
              </span>
              <span className="text-sm font-medium text-slate-500 ml-1">
                /{plan.billing_cycle === 'MONTHLY' ? 'mes' : 'año'}
              </span>
            </div>

            <div className="mt-auto pt-6 flex gap-3">
              <Button variant="outline" className="w-full">
                Editar
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

