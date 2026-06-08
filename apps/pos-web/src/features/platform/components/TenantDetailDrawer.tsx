import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../shared/query-keys';
import { Button, Input, Label } from '../../../components/ui';
import { X, CheckCircle, AlertTriangle, AlertCircle, Eye, LogIn, Edit, Trash2, Plus } from 'lucide-react';

interface TenantDetailDrawerProps {
  api: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  tenant: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function TenantDetailDrawer({ api, tenant, isOpen, onClose, onSuccess }: TenantDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'USERS' | 'CONFIG' | 'ACTIONS'>('DETAILS');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: plansData } = useQuery({
    queryKey: queryKeys.platform.plans(),
    queryFn: () => api.getPlatformPlans(),
    enabled: isOpen
  });

  const { data: usersData, refetch: refetchUsers } = useQuery({
    queryKey: queryKeys.platform.tenantUsers(tenant?.id),
    queryFn: () => api.getPlatformTenantUsers(tenant.id),
    enabled: isOpen && !!tenant && activeTab === 'USERS'
  });

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [userFormData, setUserFormData] = useState({ name: '', email: '', password: '', role: 'CASHIER', active: true });

  const [formData, setFormData] = useState({
    name: tenant?.name || '',
    business_name: tenant?.business_name || '',
    nit: tenant?.nit || '',
    tax_mode: tenant?.tax_mode || 'IVA',
    plan: tenant?.plan || 'STARTER',
    owner_email: tenant?.owner_email || '',
    owner_name: '' 
  });

  useEffect(() => {
    if (tenant) {
      setFormData({
        name: tenant.name || '',
        business_name: tenant.business_name || '',
        nit: tenant.nit || '',
        tax_mode: tenant.tax_mode || 'IVA',
        plan: tenant.plan || 'STARTER',
        owner_email: tenant.owner_email || '',
        owner_name: ''
      });
    }
  }, [tenant]);

  const [suspendReason, setSuspendReason] = useState('');

  if (!isOpen || !tenant) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.updatePlatformTenant(tenant.id, {
        name: formData.name,
        business_name: formData.business_name,
        nit: formData.nit,
        tax_mode: formData.tax_mode,
        owner_email: formData.owner_email
      });
      if (formData.plan !== tenant.plan) {
        await api.changeTenantPlan(tenant.id, formData.plan);
      }
      onSuccess();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al actualizar');
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) {
      setError('Debes proveer un motivo de suspensión');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.suspendTenant(tenant.id, suspendReason);
      onSuccess();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al suspender');
    } finally {
      setLoading(false);
    }
  };

  const handleReactivate = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.reactivateTenant(tenant.id);
      onSuccess();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al reactivar');
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async () => {
    try {
      await api.impersonateTenant(tenant.id, 'Impersonation via Dashboard');
      window.location.href = '/';
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al impersonar');
    }
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (editingUser) {
        await api.updatePlatformTenantUser(tenant.id, editingUser.id, {
          name: userFormData.name,
          role: userFormData.role,
          active: userFormData.active
        });
      } else {
        await api.createPlatformTenantUser(tenant.id, userFormData);
      }
      setShowUserForm(false);
      setEditingUser(null);
      refetchUsers();
    } catch(err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al guardar usuario');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
    setLoading(true);
    setError(null);
    try {
      await api.deletePlatformTenantUser(tenant.id, userId);
      refetchUsers();
    } catch(err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      setError(err.message || 'Error al eliminar usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div 
        className="fixed inset-0 bg-background/50 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-full md:w-[450px] bg-card z-50 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out border-l border-border">
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-start bg-card">
          <div>
            <div className="flex items-center gap-4 mb-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-xl font-bold shrink-0">
                {tenant.business_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground leading-tight">{tenant.business_name}</h2>
                <div className="text-sm text-muted-foreground mt-0.5">NIT: {tenant.document_number || tenant.nit}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                tenant.status === 'ACTIVE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 
                tenant.status === 'SUSPENDED' ? 'bg-destructive/10 text-destructive' : 
                'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {tenant.status === 'ACTIVE' && <CheckCircle size={14} />}
                {tenant.status === 'SUSPENDED' && <AlertCircle size={14} />}
                {tenant.status === 'TRIALING' && <AlertTriangle size={14} />}
                {tenant.status === 'ACTIVE' ? 'Activo' : tenant.status === 'SUSPENDED' ? 'Suspendido' : tenant.status}
              </span>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                {tenant.plan || 'STARTER'}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-2 -mr-2 -mt-2 rounded-full hover:bg-muted">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-muted/30 px-2 pt-2">
          {['DETAILS', 'USERS', 'CONFIG', 'ACTIONS'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as any)} // eslint-disable-line @typescript-eslint/no-explicit-any
              className={`flex-1 pb-3 pt-2 px-2 text-sm font-semibold transition-colors border-b-2 ${
                activeTab === tab 
                  ? 'text-primary border-primary bg-card rounded-t-lg' 
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50 rounded-t-lg'
              }`}
            >
              {tab === 'DETAILS' ? 'Detalles' : tab === 'USERS' ? 'Usuarios' : tab === 'CONFIG' ? 'Config' : 'Acciones'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-muted/10">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded-lg mb-6 text-sm flex items-start gap-3 border border-destructive/20">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {activeTab === 'DETAILS' && (
            <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-300">
              <div className="bg-card p-5 rounded-xl border border-border shadow-sm">
                <h3 className="text-sm font-semibold text-foreground mb-4 border-b border-border pb-2">Información General</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Nombre Corto</label>
                    <div className="text-sm font-medium text-foreground">{tenant.name}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Dueño / Contacto principal</label>
                    <div className="text-sm font-medium text-foreground">{tenant.owner_email || 'No asignado'}</div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Fecha de Registro</label>
                    <div className="text-sm font-medium text-foreground">{new Date(tenant.created_at).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'USERS' && (
            <div className="flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
              {!showUserForm ? (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-semibold text-foreground">Usuarios del Tenant</h3>
                    <Button 
                      size="sm" 
                      onClick={() => {
                        setEditingUser(null);
                        setUserFormData({ name: '', email: '', password: '', role: 'CASHIER', active: true });
                        setShowUserForm(true);
                      }}
                      className="gap-2"
                    >
                      <Plus size={16} /> Nuevo
                    </Button>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {usersData?.users?.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm bg-card rounded-xl border border-border">
                        No hay usuarios registrados
                      </div>
                    ) : (
                      usersData?.users?.map((u: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                        <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-border bg-card rounded-xl gap-4 shadow-sm hover:border-primary/30 transition-colors">
                          <div>
                            <div className="font-semibold text-foreground text-sm flex items-center gap-2">
                              {u.name}
                              {!u.active && <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold uppercase">Inactivo</span>}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{u.email} &middot; {u.role}</div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button 
                              variant="outline" 
                              size="sm"
                              className="h-8 px-3"
                              onClick={() => {
                                setEditingUser(u);
                                setUserFormData({ name: u.name, email: u.email, password: '', role: u.role, active: u.active });
                                setShowUserForm(true);
                              }}
                            >
                              <Edit size={14} className="mr-1.5" /> Editar
                            </Button>
                            <Button 
                              variant="destructive" 
                              size="sm"
                              className="h-8 px-3"
                              onClick={() => handleDeleteUser(u.id)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="bg-card p-5 rounded-xl border border-border shadow-sm animate-in zoom-in-95 duration-200">
                  <h3 className="text-base font-semibold text-foreground mb-5 border-b border-border pb-3">
                    {editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}
                  </h3>
                  <form onSubmit={handleSaveUser} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="userName">Nombre</Label>
                      <Input id="userName" placeholder="Nombre completo" required value={userFormData.name} onChange={e => setUserFormData({...userFormData, name: e.target.value})} />
                    </div>
                    
                    {!editingUser && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="userEmail">Correo electrónico</Label>
                          <Input id="userEmail" type="email" placeholder="ejemplo@empresa.com" required value={userFormData.email} onChange={e => setUserFormData({...userFormData, email: e.target.value})} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="userPassword">Contraseña</Label>
                          <Input id="userPassword" type="password" placeholder="Mínimo 8 caracteres" required minLength={8} value={userFormData.password} onChange={e => setUserFormData({...userFormData, password: e.target.value})} />
                        </div>
                      </>
                    )}
                    
                    <div className="space-y-2">
                      <Label htmlFor="userRole">Rol en el sistema</Label>
                      <select 
                        id="userRole"
                        value={userFormData.role} 
                        onChange={e => setUserFormData({...userFormData, role: e.target.value})}
                        className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="TENANT_OWNER">Dueño (Tenant Owner)</option>
                        <option value="ADMIN">Administrador</option>
                        <option value="MANAGER">Gerente de Sucursal</option>
                        <option value="CASHIER">Cajero</option>
                        <option value="AUDITOR">Auditor</option>
                      </select>
                    </div>
                    
                    {editingUser && (
                      <div className="flex items-center space-x-2 pt-2">
                        <input 
                          type="checkbox" 
                          id="userActive"
                          checked={userFormData.active} 
                          onChange={e => setUserFormData({...userFormData, active: e.target.checked})} 
                          className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                        />
                        <Label htmlFor="userActive" className="font-normal cursor-pointer">Usuario Activo en el sistema</Label>
                      </div>
                    )}
                    
                    <div className="flex gap-3 pt-4 border-t border-border mt-6">
                      <Button type="button" variant="outline" className="flex-1" onClick={() => setShowUserForm(false)}>
                        Cancelar
                      </Button>
                      <Button type="submit" disabled={loading} className="flex-1">
                        {loading ? 'Guardando...' : 'Guardar Usuario'}
                      </Button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {activeTab === 'CONFIG' && (
            <div className="bg-card p-5 rounded-xl border border-border shadow-sm animate-in slide-in-from-bottom-4 duration-300">
              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tenantName">Nombre Corto (URL friendly)</Label>
                  <Input id="tenantName" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tenantBusinessName">Razón Social</Label>
                  <Input id="tenantBusinessName" required value={formData.business_name} onChange={e => setFormData({...formData, business_name: e.target.value})} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tenantNit">NIT / Documento</Label>
                  <Input id="tenantNit" required value={formData.nit} onChange={e => setFormData({...formData, nit: e.target.value})} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tenantEmail">Correo de Contacto</Label>
                  <Input id="tenantEmail" type="email" value={formData.owner_email} onChange={e => setFormData({...formData, owner_email: e.target.value})} />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tenantTaxMode">Régimen Fiscal</Label>
                  <select 
                    id="tenantTaxMode"
                    value={formData.tax_mode} 
                    onChange={e => setFormData({...formData, tax_mode: e.target.value})}
                    className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="IVA">IVA (Régimen Común)</option>
                    <option value="INC_RESTAURANT">Impoconsumo</option>
                    <option value="REGIMEN_SIMPLIFICADO">Régimen Simplificado</option>
                  </select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="tenantPlan">Plan de Suscripción</Label>
                  <select 
                    id="tenantPlan"
                    value={formData.plan} 
                    onChange={e => setFormData({...formData, plan: e.target.value})}
                    className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {plansData?.plans?.map((p: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                      <option key={p.id} value={p.name}>{p.name} (${(p.price_cents / 100).toFixed(0)}/mes)</option>
                    )) || (
                      <>
                        <option value="STARTER">Starter</option>
                        <option value="PRO">Pro</option>
                        <option value="ENTERPRISE">Enterprise</option>
                      </>
                    )}
                  </select>
                </div>
                
                <div className="pt-4 border-t border-border mt-6">
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'ACTIONS' && (
            <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-300">
              <div className="bg-primary text-primary-foreground p-6 rounded-xl shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <LogIn size={80} />
                </div>
                <div className="relative z-10">
                  <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                    <Eye size={20} /> Suplantar Identidad
                  </h3>
                  <p className="text-primary-foreground/80 text-sm mb-6 max-w-[85%]">
                    Ingresa a la cuenta como si fueras el administrador del negocio. Podrás ver y modificar sus datos. 
                    <span className="block mt-1 font-semibold text-yellow-300">Esta acción será auditada.</span>
                  </p>
                  <Button 
                    onClick={handleImpersonate} 
                    className="w-full bg-background text-foreground hover:bg-muted"
                  >
                    Ingresar como Tenant &rarr;
                  </Button>
                </div>
              </div>

              {tenant.status === 'ACTIVE' ? (
                <div className="bg-card border border-destructive/30 p-6 rounded-xl shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-destructive"></div>
                  <h3 className="text-lg font-bold text-destructive mb-2 flex items-center gap-2">
                    <AlertTriangle size={20} /> Suspender Cuenta
                  </h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    El negocio y todos sus usuarios no podrán acceder al sistema de punto de venta inmediatamente.
                  </p>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="suspendReason" className="text-destructive">Motivo de suspensión (requerido)</Label>
                      <Input 
                        id="suspendReason"
                        placeholder="Ej: Falta de pago, violación de términos..." 
                        value={suspendReason} 
                        onChange={e => setSuspendReason(e.target.value)}
                        className="border-destructive/30 focus-visible:ring-destructive/50"
                      />
                    </div>
                    <Button 
                      onClick={handleSuspend} 
                      disabled={loading || !suspendReason.trim()} 
                      variant="destructive"
                      className="w-full"
                    >
                      {loading ? 'Suspendiendo...' : 'Suspender Acceso'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="bg-card border border-green-200 dark:border-green-900/30 p-6 rounded-xl shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                  <h3 className="text-lg font-bold text-green-600 dark:text-green-500 mb-2 flex items-center gap-2">
                    <CheckCircle size={20} /> Reactivar Cuenta
                  </h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    El negocio y todos sus usuarios recuperarán el acceso al sistema inmediatamente.
                  </p>
                  <Button 
                    onClick={handleReactivate} 
                    disabled={loading} 
                    className="w-full bg-green-600 hover:bg-green-700 text-white border-0 shadow-sm"
                  >
                    {loading ? 'Activando...' : 'Reactivar Cuenta'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
