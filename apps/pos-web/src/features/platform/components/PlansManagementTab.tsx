import React, { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, Button } from '../../../components/ui';
import { platformKeys } from '../../../shared/query-keys';
import { PlanFormModal } from './PlanFormModal';
import type { BillingPlan, CreateBillingPlanInput, UpdateBillingPlanInput } from '../../../lib/api';
import { Badge } from 'lucide-react';

interface PlansManagementTabProps {
  api: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function PlansManagementTab({ api }: PlansManagementTabProps) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BillingPlan | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: platformKeys.plans(),
    queryFn: () => api.getPlatformPlans()
  });

  const plans = data?.plans || [];

  const createMutation = useMutation({
    mutationFn: (payload: CreateBillingPlanInput) => api.createPlatformPlan(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.plans() })
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateBillingPlanInput }) => api.updatePlatformPlan(id, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.plans() })
  });

  const handleOpenCreate = () => {
    setEditingPlan(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (plan: BillingPlan) => {
    setEditingPlan(plan);
    setModalOpen(true);
  };

  const handleSave = async (payload: CreateBillingPlanInput | UpdateBillingPlanInput) => {
    if (editingPlan) {
      await updateMutation.mutateAsync({ id: editingPlan.id, payload: payload as UpdateBillingPlanInput });
    } else {
      await createMutation.mutateAsync(payload as CreateBillingPlanInput);
    }
  };

  if (isLoading) {
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
        <Button size="sm" onClick={handleOpenCreate}>
          + Crear Plan
        </Button>
      </div>

      {error && (
        <div className="m-6 p-4 bg-error-50 border border-error-100 text-error-700 rounded-xl text-sm font-medium">
          Error al cargar los planes
        </div>
      )}

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {plans.map((plan: BillingPlan) => (
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

            <div className="mb-6 bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex items-center text-sm text-slate-700">
                <span className="w-2 h-2 rounded-full bg-brand-500 mr-2" />
                {plan.features_json.users === -1 ? 'Usuarios ilimitados' : `Hasta ${plan.features_json.users} usuarios`}
              </div>
              <div className="flex items-center text-sm text-slate-700">
                <span className="w-2 h-2 rounded-full bg-brand-500 mr-2" />
                {plan.features_json.branches === -1 ? 'Sucursales ilimitadas' : `Hasta ${plan.features_json.branches} sucursales`}
              </div>
              <div className="flex items-center text-sm text-slate-700">
                <span className="w-2 h-2 rounded-full bg-brand-500 mr-2" />
                {plan.features_json.support_level === 'DEDICATED' ? 'Soporte Dedicado 24/7' : plan.features_json.support_level === 'PRIORITY' ? 'Soporte Prioritario' : 'Soporte Estándar'}
              </div>
            </div>

            <div className="mt-auto pt-4 flex gap-3 border-t border-slate-100">
              <Button variant="outline" className="w-full" onClick={() => handleOpenEdit(plan)}>
                Editar Plan
              </Button>
            </div>
          </div>
        ))}
      </div>

      <PlanFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        plan={editingPlan}
        onSave={handleSave}
      />
    </Card>
  );
}

