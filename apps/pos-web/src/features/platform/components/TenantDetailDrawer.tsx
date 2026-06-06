import React, { useState, useEffect } from 'react';

interface TenantDetailDrawerProps {
  api: any;
  tenant: any;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

import { useQuery } from '@tanstack/react-query';

export function TenantDetailDrawer({ api, tenant, isOpen, onClose, onSuccess }: TenantDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'DETAILS' | 'USERS' | 'CONFIG' | 'ACTIONS'>('DETAILS');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: plansData } = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api.getPlatformPlans(),
    enabled: isOpen
  });

  const { data: usersData, refetch: refetchUsers } = useQuery({
    queryKey: ['platform-tenant-users', tenant?.id],
    queryFn: () => api.getPlatformTenantUsers(tenant.id),
    enabled: isOpen && !!tenant && activeTab === 'USERS'
  });

  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [userFormData, setUserFormData] = useState({ name: '', email: '', password: '', role: 'CASHIER', active: true });

  // Edit form state
  const [formData, setFormData] = useState({
    name: tenant?.name || '',
    business_name: tenant?.business_name || '',
    nit: tenant?.nit || '',
    tax_mode: tenant?.tax_mode || 'IVA',
    plan: tenant?.plan || 'STARTER',
    owner_email: tenant?.owner_email || '',
    owner_name: '' // We don't have owner_name in the tenant object right now, but we can allow editing if needed. Wait, tenant.owner_email is passed, maybe not owner_name. I will just pass owner_email.
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    } catch (err: any) {
      setError(err.message || 'Error al reactivar');
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async () => {
    try {
      await api.impersonateTenant(tenant.id, 'Impersonation via Dashboard');
      window.location.href = '/';
    } catch (err: any) {
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
    } catch(err: any) {
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
    } catch(err: any) {
      setError(err.message || 'Error al eliminar usuario');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div 
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 40 }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '450px', background: 'white', zIndex: 50,
        boxShadow: '-4px 0 15px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--color-slate-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', background: 'var(--color-primary-50)', color: 'var(--color-primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: 700 }}>
                {tenant.business_name?.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-slate-900)', lineHeight: 1.2 }}>{tenant.business_name}</h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)' }}>NIT: {tenant.document_number || tenant.nit}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <span style={{ 
                padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                backgroundColor: tenant.status === 'ACTIVE' ? 'var(--color-success-100)' : tenant.status === 'SUSPENDED' ? 'var(--color-error-100)' : 'var(--color-warning-100)',
                color: tenant.status === 'ACTIVE' ? 'var(--color-success-700)' : tenant.status === 'SUSPENDED' ? 'var(--color-error-700)' : 'var(--color-warning-700)'
              }}>
                {tenant.status}
              </span>
              <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, backgroundColor: 'var(--color-slate-100)', color: 'var(--color-slate-700)' }}>
                {tenant.plan || 'STARTER'}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', color: 'var(--color-slate-400)' }}>&times;</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-slate-200)', background: 'var(--color-slate-50)' }}>
          {['DETAILS', 'USERS', 'CONFIG', 'ACTIONS'].map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              style={{
                flex: 1, padding: '0.75rem', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 600, color: activeTab === tab ? 'var(--color-primary-600)' : 'var(--color-slate-500)',
                borderBottom: activeTab === tab ? '2px solid var(--color-primary-600)' : '2px solid transparent'
              }}
            >
              {tab === 'DETAILS' ? 'Detalles' : tab === 'USERS' ? 'Usuarios' : tab === 'CONFIG' ? 'Configuración' : 'Acciones'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {error && <div style={{ padding: '1rem', background: 'var(--color-error-50)', color: 'var(--color-error-700)', borderRadius: '0.5rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>{error}</div>}

          {activeTab === 'DETAILS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase' }}>Nombre Corto</label><div style={{ fontWeight: 500 }}>{tenant.name}</div></div>
              <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase' }}>Dueño / Contacto</label><div style={{ fontWeight: 500 }}>{tenant.owner_email || 'No asignado'}</div></div>
              <div><label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-slate-500)', textTransform: 'uppercase' }}>Fecha de Registro</label><div style={{ fontWeight: 500 }}>{new Date(tenant.created_at).toLocaleString('es-CO')}</div></div>
            </div>
          )}

          {activeTab === 'USERS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {!showUserForm ? (
                <>
                  <button onClick={() => {
                    setEditingUser(null);
                    setUserFormData({ name: '', email: '', password: '', role: 'CASHIER', active: true });
                    setShowUserForm(true);
                  }} style={{ padding: '0.5rem', background: 'var(--color-primary-600)', color: 'white', borderRadius: '0.5rem', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                    + Nuevo Usuario
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {usersData?.users?.map((u: any) => (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--color-slate-200)', borderRadius: '0.5rem' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{u.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-slate-500)' }}>{u.email} &middot; {u.role}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button onClick={() => {
                            setEditingUser(u);
                            setUserFormData({ name: u.name, email: u.email, password: '', role: u.role, active: u.active });
                            setShowUserForm(true);
                          }} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--color-slate-100)', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>Editar</button>
                          <button onClick={() => handleDeleteUser(u.id)} style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'var(--color-error-50)', color: 'var(--color-error-600)', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>Eliminar</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <form onSubmit={handleSaveUser} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--color-slate-50)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-200)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                  <input placeholder="Nombre" required value={userFormData.name} onChange={e => setUserFormData({...userFormData, name: e.target.value})} style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--color-slate-300)' }} />
                  {!editingUser && (
                    <>
                      <input type="email" placeholder="Correo electrónico" required value={userFormData.email} onChange={e => setUserFormData({...userFormData, email: e.target.value})} style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--color-slate-300)' }} />
                      <input type="password" placeholder="Contraseña (min 8)" required minLength={8} value={userFormData.password} onChange={e => setUserFormData({...userFormData, password: e.target.value})} style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--color-slate-300)' }} />
                    </>
                  )}
                  <select value={userFormData.role} onChange={e => setUserFormData({...userFormData, role: e.target.value})} style={{ padding: '0.5rem', borderRadius: '0.25rem', border: '1px solid var(--color-slate-300)' }}>
                    <option value="TENANT_OWNER">Dueño (Tenant Owner)</option>
                    <option value="ADMIN">Administrador</option>
                    <option value="MANAGER">Gerente de Sucursal</option>
                    <option value="CASHIER">Cajero</option>
                    <option value="AUDITOR">Auditor</option>
                  </select>
                  {editingUser && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={userFormData.active} onChange={e => setUserFormData({...userFormData, active: e.target.checked})} />
                      Usuario Activo
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button type="submit" disabled={loading} style={{ flex: 1, padding: '0.5rem', background: 'var(--color-primary-600)', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>Guardar</button>
                    <button type="button" onClick={() => setShowUserForm(false)} style={{ padding: '0.5rem', background: 'var(--color-slate-200)', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}>Cancelar</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {activeTab === 'CONFIG' && (
            <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Nombre Corto</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Razón Social</label>
                <input required value={formData.business_name} onChange={e => setFormData({...formData, business_name: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>NIT</label>
                <input required value={formData.nit} onChange={e => setFormData({...formData, nit: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Correo del Dueño / Contacto</label>
                <input type="email" value={formData.owner_email} onChange={e => setFormData({...formData, owner_email: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Régimen Fiscal</label>
                <select value={formData.tax_mode} onChange={e => setFormData({...formData, tax_mode: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }}>
                  <option value="IVA">IVA</option>
                  <option value="INC_RESTAURANT">Impoconsumo</option>
                  <option value="REGIMEN_SIMPLIFICADO">Régimen Simplificado</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>Plan de Suscripción</label>
                <select value={formData.plan} onChange={e => setFormData({...formData, plan: e.target.value})} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-300)' }}>
                  {plansData?.plans?.map((p: any) => (
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
              <button type="submit" disabled={loading} style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--color-primary-600)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                Guardar Cambios
              </button>
            </form>
          )}

          {activeTab === 'ACTIONS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ background: 'var(--color-slate-50)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--color-slate-200)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Suplantar Identidad</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-slate-500)', marginBottom: '1rem' }}>Ingresa a la cuenta como si fueras el administrador del negocio. Esta acción será auditada.</p>
                <button onClick={handleImpersonate} style={{ width: '100%', padding: '0.75rem', background: 'var(--color-slate-900)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, cursor: 'pointer' }}>
                  Ingresar como Tenant
                </button>
              </div>

              {tenant.status === 'ACTIVE' ? (
                <div style={{ background: 'var(--color-error-50)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--color-error-200)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-error-700)', marginBottom: '0.5rem' }}>Suspender Cuenta</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-error-600)', marginBottom: '1rem' }}>El negocio no podrá acceder al sistema de punto de venta.</p>
                  <input 
                    placeholder="Motivo de suspensión..." 
                    value={suspendReason} 
                    onChange={e => setSuspendReason(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-error-300)', marginBottom: '1rem' }} 
                  />
                  <button onClick={handleSuspend} disabled={loading} style={{ width: '100%', padding: '0.75rem', background: 'var(--color-error-600)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                    Suspender
                  </button>
                </div>
              ) : (
                <div style={{ background: 'var(--color-success-50)', padding: '1rem', borderRadius: '0.5rem', border: '1px solid var(--color-success-200)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-success-700)', marginBottom: '0.5rem' }}>Reactivar Cuenta</h3>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-success-600)', marginBottom: '1rem' }}>El negocio recuperará el acceso al sistema.</p>
                  <button onClick={handleReactivate} disabled={loading} style={{ width: '100%', padding: '0.75rem', background: 'var(--color-success-600)', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.7 : 1 }}>
                    Activar Cuenta
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
