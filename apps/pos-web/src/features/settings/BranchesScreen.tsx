import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner, Modal, ShellMessage } from '../../components/ui';
import type { BranchItem } from '../../lib/api/client';
import { useApi, useSession } from '../auth';
import { userKeys } from '../../shared/query-keys';


export function BranchesScreen() {
  const api = useApi();
  const { tenantId } = useSession();
  const queryClient = useQueryClient();

  const consulta = useQuery({
    queryKey: userKeys.branches(tenantId),
    queryFn: async () => (await api.listBranches()).items
  });

  const branches: BranchItem[] = consulta.data ?? [];
  const isLoading = consulta.isPending;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const guardar = useMutation({
    mutationFn: () =>
      (editingBranch
        ? api.updateBranch(editingBranch.id, { name, address })
        : api.createBranch({ name, address })),
    onSuccess: async () => {
      setIsModalOpen(false);
      // La lista de sucursales no vive solo en esta pantalla —el selector de sede y los
      // informes leen la misma clave—, así que invalidarla es lo que pone al día a todos
      // sin que nadie tenga que recargar.
      await queryClient.invalidateQueries({ queryKey: userKeys.branches(tenantId) });
    }
  });

  const isSaving = guardar.isPending;

  const error = consulta.error
    ? (consulta.error instanceof Error ? consulta.error.message : 'Error al cargar sucursales')
    : guardar.error
      ? (guardar.error instanceof Error ? guardar.error.message : 'Error al guardar sucursal')
      : null;

  const openNewBranchModal = () => {
    setEditingBranch(null);
    setName('');
    setAddress('');
    setIsModalOpen(true);
  };

  const openEditBranchModal = (b: BranchItem) => {
    setEditingBranch(b);
    setName(b.name);
    setAddress(b.address);
    setIsModalOpen(true);
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !address.trim()) return;
    guardar.mutate();
  };

  if (isLoading) {
    return <ShellMessage title="Cargando sucursales..." subtitle="Consultando configuración de sedes" />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', minHeight: '0' }}>
      <div className="heading-row">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Gestión de Sucursales</h2>
          <p style={{ color: 'var(--color-slate-400)', margin: '0.25rem 0 0 0' }}>
            Administra las sedes físicas o lógicas de tu negocio
          </p>
        </div>
        <button onClick={openNewBranchModal} className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
          + Nueva Sucursal
        </button>
      </div>

      {error && !isModalOpen && <Banner tone="error">{error}</Banner>}

      {branches.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Sin sucursales</h3>
          <p style={{ color: 'var(--color-slate-500)', marginBottom: '1.5rem' }}>
            No tienes sucursales creadas. Crea una para comenzar a operar.
          </p>
          <button className="button" onClick={openNewBranchModal}>Crear Sucursal</button>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-slate-700)', borderRadius: '8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid var(--color-slate-700)', backgroundColor: 'var(--color-slate-800)' }}>
              <tr>
                <th style={{ padding: '0.75rem 1rem' }}>Nombre</th>
                <th style={{ padding: '0.75rem 1rem' }}>Dirección</th>
                <th style={{ padding: '0.75rem 1rem' }}>Creado el</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--color-slate-800)' }}>
                  <td style={{ padding: '0.75rem 1rem' }}><strong>{b.name}</strong></td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{b.address}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{new Date(b.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button className="ghost-button button-sm" onClick={() => openEditBranchModal(b)}>
                      ✏️ Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <Modal
          ariaLabel={editingBranch ? 'Editar Sucursal' : 'Nueva Sucursal'}
          onClose={() => setIsModalOpen(false)}
        >
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              {editingBranch ? 'Editar Sucursal' : 'Nueva Sucursal'}
            </h3>
            <form onSubmit={handleSave} className="stack-md">
              {error && <Banner tone="error">{error}</Banner>}

              <label className="field">
                <span>Nombre de Sucursal</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Sede Norte"
                  required
                />
              </label>

              <label className="field">
                <span>Dirección Física</span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Calle 1 # 2-3 Sur, Ciudad"
                  required
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </button>
                <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }} disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Guardar Sucursal'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
