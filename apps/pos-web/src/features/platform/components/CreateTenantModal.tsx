import { useState, useEffect } from 'react';

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Crear Organización</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
          )}
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre Corto</label>
              <input required value={formData.tenant_name} onChange={e => setFormData({...formData, tenant_name: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" placeholder="Ej. Mi Tienda" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Razón Social</label>
              <input required value={formData.tenant_business_name} onChange={e => setFormData({...formData, tenant_business_name: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" placeholder="Mi Tienda S.A.S" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo Documento</label>
              <select value={formData.tenant_document_type} onChange={e => setFormData({...formData, tenant_document_type: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg">
                <option value="NIT">NIT</option>
                <option value="CC">Cédula</option>
                <option value="CE">CE</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Número Documento</label>
              <input required value={formData.tenant_document_number} onChange={e => setFormData({...formData, tenant_document_number: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" />
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
            <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200">Usuario Administrador</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre Completo</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Correo Electrónico</label>
                <input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contraseña Inicial</label>
                <input required type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg" />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
            <h3 className="text-md font-semibold mb-3 text-gray-800 dark:text-gray-200">Configuración Comercial</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plan de Suscripción</label>
                <select value={formData.plan} onChange={e => setFormData({...formData, plan: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg">
                  {plans.map(p => (
                    <option key={p.name} value={p.name}>{p.name} - ${(p.price_cents / 100).toLocaleString()}</option>
                  ))}
                  {plans.length === 0 && <option value="STARTER">STARTER</option>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Régimen Fiscal</label>
                <select value={formData.tax_mode} onChange={e => setFormData({...formData, tax_mode: e.target.value})} className="w-full border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg">
                  <option value="IVA">IVA</option>
                  <option value="INC_RESTAURANT">Impoconsumo</option>
                  <option value="REGIMEN_SIMPLIFICADO">Régimen Simplificado</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50">
              {loading ? 'Creando...' : 'Crear Organización'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
