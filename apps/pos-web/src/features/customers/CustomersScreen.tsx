import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { ReceivablesPanel } from './components/ReceivablesPanel';
import type { Customer } from '../../lib/api';
import { Banner, Modal, ShellMessage } from '../../components/ui';

interface CustomersScreenProps {
  api: ReturnType<typeof import('../../lib/api').createApiClient>;
  /** Necesarios para recibir abonos: un abono en efectivo entra al turno de caja. */
  branchId?: string;
  cashSessionId?: string | null;
}

/**
 * Clientes y cartera, en dos pestañas.
 *
 * La cartera vive aquí y no en un menú aparte porque es la misma persona: quien pregunta
 * «¿cuánto debe doña Rosa?» está mirando su ficha de cliente, no un informe financiero.
 */
export function CustomersScreen({ api, branchId, cashSessionId }: CustomersScreenProps) {
  const [pestana, setPestana] = useState<'DIRECTORIO' | 'CARTERA'>('DIRECTORIO');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [docType, setDocType] = useState<Customer['document_type']>('CC');
  const [docNumber, setDocNumber] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listCustomers();
      setCustomers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar clientes');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const openNewCustomerModal = () => {
    setEditingCustomer(null);
    setDocType('CC');
    setDocNumber('');
    setName('');
    setEmail('');
    setPhone('');
    setAddress('');
    setIsModalOpen(true);
  };

  const openEditCustomerModal = (c: Customer) => {
    setEditingCustomer(c);
    setDocType(c.document_type as Customer['document_type']);
    setDocNumber(c.document_number);
    setName(c.name);
    setEmail(c.email ?? '');
    setPhone(c.phone ?? '');
    setAddress(c.address ?? '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !docNumber.trim()) return;

    setIsSaving(true);
    setError(null);
    try {
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, {
          document_type: docType,
          document_number: docNumber,
          name,
          email: email || null,
          phone: phone || null,
          address: address || null
        });
      } else {
        await api.createCustomer({
          document_type: docType,
          document_number: docNumber,
          name,
          email: email || null,
          phone: phone || null,
          address: address || null
        });
      }
      setIsModalOpen(false);
      await loadCustomers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar cliente');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <ShellMessage title="Cargando directorio de clientes..." subtitle="Conectando con DIAN" />;
  }

  const pestanas = (
    <div className="flex gap-4 border-b border-border px-4">
      {(
        [
          ['DIRECTORIO', 'Directorio'],
          ['CARTERA', 'Cartera']
        ] as const
      ).map(([id, etiqueta]) => (
        <button
          key={id}
          onClick={() => setPestana(id)}
          className={`pb-3 px-1 text-sm font-semibold transition-colors border-b-2 whitespace-nowrap ${
            pestana === id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
          }`}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  );

  if (pestana === 'CARTERA') {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {pestanas}
        <div className="p-4">
          {branchId ? (
            <ReceivablesPanel api={api} branchId={branchId} cashSessionId={cashSessionId} />
          ) : (
            <p className="text-sm text-muted-foreground">Selecciona una sucursal para ver la cartera.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1rem', minHeight: '0' }}>
      {pestanas}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Directorio de Clientes</h2>
          <p style={{ color: 'var(--color-slate-400)', margin: '0.25rem 0 0 0' }}>
            Gestiona los terceros para la facturación electrónica
          </p>
        </div>
        <button onClick={openNewCustomerModal} className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
          + Nuevo Cliente
        </button>
      </div>

      {error && !isModalOpen && <Banner tone="error">{error}</Banner>}

      {customers.length === 0 ? (
        <div className="empty-state" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
          <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>Sin clientes</h3>
          <p style={{ color: 'var(--color-slate-500)', marginBottom: '1.5rem' }}>
            Agrega clientes para vincularlos en tus ventas (Requerido para facturación nominativa DIAN).
          </p>
          <button className="button" onClick={openNewCustomerModal}>Crear Cliente</button>
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-slate-700)', borderRadius: '8px', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead style={{ borderBottom: '1px solid var(--color-slate-700)', backgroundColor: 'var(--color-slate-800)' }}>
              <tr>
                <th style={{ padding: '0.75rem 1rem' }}>Tipo Doc.</th>
                <th style={{ padding: '0.75rem 1rem' }}>Número Doc.</th>
                <th style={{ padding: '0.75rem 1rem' }}>Razón Social / Nombre</th>
                <th style={{ padding: '0.75rem 1rem' }}>Email</th>
                <th style={{ padding: '0.75rem 1rem' }}>Teléfono</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-slate-800)' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span className="tag tag-info">{c.document_type}</span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}><strong>{c.document_number}</strong></td>
                  <td style={{ padding: '0.75rem 1rem' }}>{c.name}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{c.email || '-'}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-slate-400)' }}>{c.phone || '-'}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                    <button className="ghost-button button-sm" onClick={() => openEditCustomerModal(c)}>
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
          ariaLabel={editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
          onClose={() => setIsModalOpen(false)}
        >
          <div style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
              {editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
            </h3>
            <form onSubmit={handleSave} className="stack-md">
              {error && <Banner tone="error">{error}</Banner>}
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem' }}>
                <label className="field">
                  <span>Tipo Documento</span>
                  <select
                    value={docType}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => setDocType(e.target.value as Customer['document_type'])}
                    required
                  >
                    <option value="CC">Cédula</option>
                    <option value="NIT">NIT</option>
                    <option value="CE">Cédula Extranjería</option>
                    <option value="PASSPORT">Pasaporte</option>
                  </select>
                </label>

                <label className="field">
                  <span>Número de Documento</span>
                  <input
                    value={docNumber}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setDocNumber(e.target.value)}
                    placeholder="Ej: 900123456-7"
                    required
                  />
                </label>
              </div>

              <label className="field">
                <span>Razón Social o Nombres y Apellidos</span>
                <input
                  value={name}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                  placeholder="Persona o Empresa SAS"
                  required
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <label className="field">
                  <span>Correo Electrónico</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    placeholder="cliente@correo.com"
                  />
                </label>
                <label className="field">
                  <span>Teléfono Móvil</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                    placeholder="300 000 0000"
                  />
                </label>
              </div>

              <label className="field">
                <span>Dirección Física</span>
                <input
                  value={address}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAddress(e.target.value)}
                  placeholder="Calle 1 # 2-3 Sur, Ciudad"
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSaving}
                >
                  Cancelar
                </button>
                <button type="submit" className="button" style={{ background: 'var(--color-primary-600)', color: '#fff' }} disabled={isSaving}>
                  {isSaving ? 'Guardando...' : 'Guardar Cliente'}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
}
