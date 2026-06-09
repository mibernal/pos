import React, { useState, useEffect } from 'react';
import { Button } from '../../../components/ui';
import { Modal } from '../../../components/ui/Modal';
import type { BillingPlan, CreateBillingPlanInput, UpdateBillingPlanInput } from '../../../lib/api';

interface PlanFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: BillingPlan | null; // null means we are creating
  onSave: (data: CreateBillingPlanInput | UpdateBillingPlanInput) => Promise<void>;
}

export function PlanFormModal({ open, onOpenChange, plan, onSave }: PlanFormModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [priceCents, setPriceCents] = useState(0);
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const [active, setActive] = useState(true);
  const [users, setUsers] = useState(1);
  const [branches, setBranches] = useState(1);
  const [supportLevel, setSupportLevel] = useState<'STANDARD' | 'PRIORITY' | 'DEDICATED'>('STANDARD');

  useEffect(() => {
    if (plan && open) {
      setId(plan.id);
      setName(plan.name);
      setPriceCents(plan.price_cents);
      setBillingCycle(plan.billing_cycle);
      setActive(plan.active);
      setUsers(plan.features_json?.users ?? -1);
      setBranches(plan.features_json?.branches ?? -1);
      setSupportLevel(plan.features_json?.support_level ?? 'STANDARD');
    } else if (open) {
      setId('');
      setName('');
      setPriceCents(0);
      setBillingCycle('MONTHLY');
      setActive(true);
      setUsers(1);
      setBranches(1);
      setSupportLevel('STANDARD');
    }
    setError(null);
  }, [plan, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !name) {
      setError('El ID y el nombre son requeridos');
      return;
    }
    setLoading(true);
    setError(null);

    const featuresJson = {
      users,
      branches,
      support_level: supportLevel
    };

    try {
      if (plan) {
        await onSave({
          name,
          price_cents: priceCents,
          billing_cycle: billingCycle,
          active,
          features_json: featuresJson
        });
      } else {
        await onSave({
          id,
          name,
          price_cents: priceCents,
          billing_cycle: billingCycle,
          features_json: featuresJson
        });
      }
      onOpenChange(false);
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al guardar el plan');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Modal ariaLabel={plan ? 'Editar Plan' : 'Crear Plan'} onClose={() => onOpenChange(false)} size="wide">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-900">{plan ? 'Editar Plan' : 'Crear Plan'}</h2>
      </div>

      {error && (
        <div className="bg-error-50 text-error-700 p-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {!plan && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">ID (Slug)</label>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value.toUpperCase())}
                className="w-full rounded-xl border-slate-300 focus:border-brand-500 focus:ring-brand-500 shadow-sm transition-colors uppercase"
                placeholder="Ej. STARTER_V2"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Plan</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border-slate-300 focus:border-brand-500 focus:ring-brand-500 shadow-sm transition-colors"
              placeholder="Ej. Plan Starter"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Precio (Centavos)</label>
              <input
                type="number"
                value={priceCents}
                onChange={(e) => setPriceCents(Number(e.target.value))}
                className="w-full rounded-xl border-slate-300 focus:border-brand-500 focus:ring-brand-500 shadow-sm transition-colors"
                min="0"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Ciclo</label>
              <select
                value={billingCycle}
                onChange={(e) => setBillingCycle(e.target.value as 'MONTHLY' | 'YEARLY')}
                className="w-full rounded-xl border-slate-300 focus:border-brand-500 focus:ring-brand-500 shadow-sm transition-colors"
              >
                <option value="MONTHLY">Mensual</option>
                <option value="YEARLY">Anual</option>
              </select>
            </div>
          </div>

          {plan && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <label htmlFor="active" className="text-sm font-medium text-slate-700">Plan Activo</label>
            </div>
          )}

          <div className="border-t border-slate-200 pt-4 mt-4">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Límites y Características</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Usuarios (-1 para Ilimitado)</label>
                <input
                  type="number"
                  value={users}
                  onChange={(e) => setUsers(Number(e.target.value))}
                  className="w-full rounded-xl border-slate-300 text-sm shadow-sm"
                  min="-1"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sucursales (-1 para Ilimitado)</label>
                <input
                  type="number"
                  value={branches}
                  onChange={(e) => setBranches(Number(e.target.value))}
                  className="w-full rounded-xl border-slate-300 text-sm shadow-sm"
                  min="-1"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nivel de Soporte</label>
              <select
                value={supportLevel}
                onChange={(e) => setSupportLevel(e.target.value as 'STANDARD' | 'PRIORITY' | 'DEDICATED')}
                className="w-full rounded-xl border-slate-300 text-sm shadow-sm"
              >
                <option value="STANDARD">Estándar</option>
                <option value="PRIORITY">Prioritario</option>
                <option value="DEDICATED">Dedicado</option>
              </select>
            </div>
          </div>

          <div className="pt-4 mt-4 flex justify-end gap-2 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar Plan'}
            </Button>
          </div>
        </form>
    </Modal>
  );
}
