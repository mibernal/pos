import { useState, useEffect } from 'react';
import { Button, Input, Label } from '../../../components/ui';

interface CreateTenantModalProps {
  api: any;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateTenantModal({ api, onClose, onSuccess }: CreateTenantModalProps) {
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    tenant_name: '',
    tenant_business_name: '',
    tenant_document_type: 'NIT',
    tenant_document_number: '',
    email: '',
    password: '',
    name: '',
    tax_mode: 'IVA',
    plan: 'STARTER'
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getPlatformPlans().then((res: any) => setPlans(res.plans || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.createPlatformTenant(formData);
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Error al crear la organización');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center sticky top-0 bg-white/95 backdrop-blur z-10">
          <h2 className="text-xl font-bold text-slate-900">Crear Nueva Organización</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-full hover:bg-slate-100">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-8">
          {error && (
            <div className="p-4 bg-error-50 border border-error-100 text-error-700 rounded-xl text-sm font-medium">{error}</div>
          )}
          
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide border-b border-slate-100 pb-2">Datos de la Empresa</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Nombre Corto</Label>
                <Input required value={formData.tenant_name} onChange={e => setFormData({...formData, tenant_name: e.target.value})} placeholder="ej. mi-tienda" />
              </div>
              <div className="space-y-2">
                <Label>Razón Social</Label>
                <Input required value={formData.tenant_business_name} onChange={e => setFormData({...formData, tenant_business_name: e.target.value})} placeholder="Mi Tienda S.A.S" />
              </div>
              <div className="space-y-2">
                <Label>Tipo Documento</Label>
                <select value={formData.tenant_document_type} onChange={e => setFormData({...formData, tenant_document_type: e.target.value})} className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <option value="NIT">NIT</option>
                  <option value="CC">Cédula</option>
                  <option value="CE">CE</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Número Documento</Label>
                <Input required value={formData.tenant_document_number} onChange={e => setFormData({...formData, tenant_document_number: e.target.value})} placeholder="900.000.000-1" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide border-b border-slate-100 pb-2">Usuario Administrador</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2 md:col-span-2">
                <Label>Nombre Completo</Label>
                <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Juan Pérez" />
              </div>
              <div className="space-y-2">
                <Label>Correo Electrónico</Label>
                <Input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="admin@empresa.com" />
              </div>
              <div className="space-y-2">
                <Label>Contraseña Inicial</Label>
                <Input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder="Mínimo 8 caracteres" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide border-b border-slate-100 pb-2">Configuración Comercial</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label>Plan de Suscripción</Label>
                <select value={formData.plan} onChange={e => setFormData({...formData, plan: e.target.value})} className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  {plans.map(p => (
                    <option key={p.name} value={p.name}>{p.name} - ${(p.price_cents / 100).toLocaleString('es-CO')}/mes</option>
                  ))}
                  {plans.length === 0 && <option value="STARTER">STARTER</option>}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Régimen Fiscal</Label>
                <select value={formData.tax_mode} onChange={e => setFormData({...formData, tax_mode: e.target.value})} className="flex h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  <option value="IVA">IVA (Régimen Común)</option>
                  <option value="INC_RESTAURANT">Impoconsumo</option>
                  <option value="REGIMEN_SIMPLIFICADO">Régimen Simplificado</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6 border-t border-slate-100 mt-8">
            <Button type="button" variant="outline" onClick={onClose} className="px-6">
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="px-8">
              {loading ? 'Creando...' : 'Crear Organización'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
