import { useState } from 'react';
import { PageHeader, Banner } from '../../components/ui';
import { useReservations, useUpdateReservationStatus } from './api/reservations.api';
import { ReservationModal } from './components/ReservationModal';
import { format, startOfDay, endOfDay } from 'date-fns';
import type { Reservation, ReservationStatus } from '@pos-dian/shared';

interface Props {
  branchId: string;
}

const STATUS_COLORS: Record<ReservationStatus, string> = {
  PENDING: 'var(--color-warning-500)',
  CONFIRMED: 'var(--color-primary-500)',
  SEATED: 'var(--color-success-500)',
  CANCELLED: 'var(--color-danger-500)',
  NO_SHOW: 'var(--color-neutral-500)',
};

const STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  SEATED: 'Sentado',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No Show',
};

export function ReservationsScreen({ branchId }: Props) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);

  const dateFrom = startOfDay(selectedDate).toISOString();
  const dateTo = endOfDay(selectedDate).toISOString();

  const { data: reservations, isLoading, error } = useReservations(branchId, dateFrom, dateTo);
  const { mutateAsync: updateStatus } = useUpdateReservationStatus(branchId);

  const handleStatusChange = async (id: string, status: ReservationStatus) => {
    try {
      await updateStatus({ id, status });
    } catch (e) {
      console.error('Error actualizando estado:', e);
      alert('Error al actualizar el estado');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <PageHeader
        title="Reservaciones"
        subtitle={`Gestiona las reservaciones del día.`}
        actions={
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <input 
              type="date" 
              value={format(selectedDate, 'yyyy-MM-dd')}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(new Date(e.target.value + 'T00:00:00'));
                }
              }}
              style={{
                padding: '0.5rem',
                borderRadius: '0.375rem',
                border: '1px solid var(--color-neutral-300)',
              }}
            />
            <button
              onClick={() => {
                setEditingReservation(null);
                setIsModalOpen(true);
              }}
              style={{
                backgroundColor: 'var(--color-primary-600)',
                color: 'white',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '0.375rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Nueva Reserva
            </button>
          </div>
        }
      />

      {error && <Banner tone="error">Error al cargar reservaciones.</Banner>}

      <div style={{ 
        backgroundColor: 'white', 
        borderRadius: '0.5rem', 
        border: '1px solid var(--color-neutral-200)',
        overflow: 'hidden'
      }}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Cargando...</div>
        ) : !reservations?.length ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-neutral-500)' }}>
            <p>No hay reservaciones para el {format(selectedDate, 'dd/MM/yyyy')}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ backgroundColor: 'var(--color-neutral-50)', borderBottom: '1px solid var(--color-neutral-200)' }}>
              <tr>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Hora</th>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Cliente</th>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Pax</th>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Estado</th>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Notas</th>
                <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--color-neutral-700)' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map(res => (
                <tr key={res.id} style={{ borderBottom: '1px solid var(--color-neutral-100)' }}>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ fontWeight: 600 }}>{format(new Date(res.reservationDate), 'HH:mm')}</span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 500 }}>{res.customerName}</div>
                    {res.customerPhone && <div style={{ fontSize: '0.875rem', color: 'var(--color-neutral-500)' }}>{res.customerPhone}</div>}
                  </td>
                  <td style={{ padding: '1rem' }}>{res.guestsCount}</td>
                  <td style={{ padding: '1rem' }}>
                    <select
                      value={res.status}
                      onChange={(e) => handleStatusChange(res.id, e.target.value as ReservationStatus)}
                      style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        border: `1px solid ${STATUS_COLORS[res.status]}`,
                        backgroundColor: `${STATUS_COLORS[res.status]}20`,
                        color: STATUS_COLORS[res.status],
                        fontWeight: 600,
                        fontSize: '0.875rem'
                      }}
                    >
                      {Object.entries(STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ padding: '1rem', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {res.notes || '-'}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <button
                      onClick={() => {
                        setEditingReservation(res);
                        setIsModalOpen(true);
                      }}
                      style={{
                        padding: '0.25rem 0.5rem',
                        backgroundColor: 'transparent',
                        border: '1px solid var(--color-neutral-300)',
                        borderRadius: '0.25rem',
                        cursor: 'pointer'
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ReservationModal
        branchId={branchId}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        reservation={editingReservation}
      />
    </div>
  );
}
