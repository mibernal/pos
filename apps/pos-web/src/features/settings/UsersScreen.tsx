import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PosApiClient } from '../../types';
import { Banner, Modal, ShellMessage } from '../../components/ui';
import type { UserRole } from '../../lib/api/client';
import { useSession } from '../auth';

interface UsersScreenProps {
  api: PosApiClient;
}

type UserItem = { id: string; tenantId: string; email: string; name: string; role: UserRole; active: boolean; createdAt: string };

export function UsersScreen({ api }: UsersScreenProps) {
  const { session } = useSession();
  const currentRole = session?.user.role;
  const canCreateAdmin = currentRole === 'PLATFORM_OWNER' || currentRole === 'TENANT_OWNER';
  const isStarterPlan = session?.user.tenantPlan === 'STARTER';
  const canCreateManager = (canCreateAdmin || currentRole === 'ADMIN') && !isStarterPlan;
  const queryClient = useQueryClient();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Create Form State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('CASHIER');
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);

  const { data: usersData, isLoading: isLoadingUsers, error: usersError } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.listUsers()
  });

  const { data: branchesData, isLoading: isLoadingBranches } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.listBranches()
  });

  const createUserMutation = useMutation({
    mutationFn: (newUser: Parameters<PosApiClient['createUser']>[0]) => api.createUser(newUser),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsCreateModalOpen(false);
    }
  });

  const assignBranchesMutation = useMutation({
    mutationFn: (params: { id: string; branchIds: string[] }) => api.updateUserBranches(params.id, params.branchIds),
    onSuccess: () => {
      setIsAssignModalOpen(false);
    }
  });

  const users = usersData || [];
  const branches = branchesData?.items || [];
  const isLoading = isLoadingUsers || isLoadingBranches;
  const isSaving = createUserMutation.isPending || assignBranchesMutation.isPending;
  const mutationError = createUserMutation.error || assignBranchesMutation.error;
  
  const errorObj = usersError || mutationError;
  const errorMessage = errorObj instanceof Error ? errorObj.message : (errorObj as string | null);

  const openNewUserModal = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('CASHIER');
    setSelectedBranchIds([]);
    setIsCreateModalOpen(true);
  };

  const openAssignModal = (u: UserItem) => {
    setSelectedUser(u);
    // Since the API doesn't return user branches yet, we start empty for security/simplicity.
    // Ideally the user GET endpoint should return branchIds so we can pre-select them.
    setSelectedBranchIds([]);
    setIsAssignModalOpen(true);
  };

  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault();
    createUserMutation.mutate({
      name,
      email,
      password,
      role,
      active: true,
      branch_ids: selectedBranchIds
    });
  };

  const handleAssignSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    assignBranchesMutation.mutate({
      id: selectedUser.id,
      branchIds: selectedBranchIds
    });
  };

  const toggleBranchSelection = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId]
    );
  };

  if (isLoading) {
    return <ShellMessage title="Cargando usuarios..." subtitle="Consultando directorio de personal" />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', minHeight: '0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Gestión de Usuarios</h2>
          <p style={{ color: 'var(--color-slate-400)', margin: '0.25rem 0 0 0' }}>
            Administra los accesos y roles de tu equipo
          </p>
        </div>
        <button onClick={openNewUserModal} className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
          + Nuevo Usuario
        </button>
      </div>

      {isStarterPlan && (currentRole === 'TENANT_OWNER' || currentRole === 'ADMIN') && (
        <Banner tone="info">
          Tu plan actual (Básico) solo permite crear Cajeros. Actualiza a Pro para habilitar roles de Gerente y Auditor.
        </Banner>
      )}

      {errorMessage && !isCreateModalOpen && !isAssignModalOpen && <Banner tone="error">{errorMessage}</Banner>}

      {users.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Sin usuarios</h3>
          <p style={{ color: 'var(--color-slate-500)', marginBottom: '1.5rem' }}>
            Crea cuentas para tu personal operativo.
          </p>
          <button className="button" onClick={openNewUserModal}>Crear Usuario</button>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-slate-700)', borderRadius: '8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid var(--color-slate-700)', backgroundColor: 'var(--color-slate-800)' }}>
              <tr>
                <th style={{ padding: '0.75rem 1rem' }}>Nombre</th>
                <th style={{ padding: '0.75rem 1rem' }}>Email</th>
                <th style={{ padding: '0.75rem 1rem' }}>Rol</th>
                <th style={{ padding: '0.75rem 1rem' }}>Estado</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--color-slate-800)' }}>
                  <td style={{ padding: '0.75rem 1rem' }}><strong>{u.name}</strong></td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{u.email}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`tag ${u.role === 'PLATFORM_OWNER' ? 'tag-critical' : u.role === 'TENANT_OWNER' ? 'tag-warning' : 'tag-info'}`}>{u.role}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className={`tag ${u.active ? 'tag-success' : 'tag-error'}`}>
                      {u.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    {u.role === 'CASHIER' && (
                      <button className="ghost-button button-sm" onClick={() => openAssignModal(u)}>
                        🏢 Asignar Sucursales
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isCreateModalOpen && (
        <Modal ariaLabel="Nuevo Usuario" onClose={() => setIsCreateModalOpen(false)}>
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>Nuevo Usuario</h3>
            <form onSubmit={handleCreateSubmit} className="stack-md">
              {errorMessage && <Banner tone="error">{errorMessage}</Banner>}

              <label className="field">
                <span>Nombre Completo</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Juan Pérez"
                  required
                />
              </label>

              <label className="field">
                <span>Correo Electrónico</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="juan@empresa.com"
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  <span>Contraseña Temporal</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <label className="field">
                  <span>Rol</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    required
                  >
                    <option value="CASHIER">Cajero</option>
                    {canCreateManager && <option value="MANAGER">Gerente</option>}
                    {canCreateManager && <option value="AUDITOR">Auditor</option>}
                    {canCreateAdmin && <option value="ADMIN">Administrador</option>}
                  </select>
                </label>
              </div>

              {role === 'CASHIER' && branches.length > 0 && (
                <div className="field">
                  <span>Asignar Sucursales</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto', padding: '0.5rem', border: '1px solid var(--color-slate-700)', borderRadius: '4px' }}>
                    {branches.map(b => (
                      <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={selectedBranchIds.includes(b.id)}
                          onChange={() => toggleBranchSelection(b.id)}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="ghost-button" onClick={() => setIsCreateModalOpen(false)} disabled={isSaving}>Cancelar</button>
                <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }} disabled={isSaving}>
                  {isSaving ? 'Creando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}

      {isAssignModalOpen && selectedUser && (
        <Modal ariaLabel="Asignar Sucursales" onClose={() => setIsAssignModalOpen(false)}>
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Asignar Sucursales</h3>
            <p style={{ color: 'var(--color-slate-400)', marginBottom: '1.5rem' }}>Usuario: {selectedUser.name}</p>
            
            <form onSubmit={handleAssignSubmit} className="stack-md">
              {errorMessage && <Banner tone="error">{errorMessage}</Banner>}

              <div className="field">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', padding: '1rem', border: '1px solid var(--color-slate-700)', borderRadius: '4px' }}>
                  {branches.length === 0 ? <p>No hay sucursales disponibles.</p> : branches.map(b => (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedBranchIds.includes(b.id)}
                        onChange={() => toggleBranchSelection(b.id)}
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="ghost-button" onClick={() => setIsAssignModalOpen(false)} disabled={isSaving}>Cancelar</button>
                <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }} disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Guardar Asignación'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
