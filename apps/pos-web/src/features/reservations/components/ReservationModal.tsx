import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiClient } from '../../../lib/api';
import { Modal } from '../../../components/ui/Modal';
import { Input, Button } from '../../../components/ui';
import { useCreateReservation, useUpdateReservation } from '../api/reservations.api';
import { format } from 'date-fns';
import type { Reservation } from '@pos-dian/shared';

const formSchema = z.object({
  customerName: z.string().min(1, 'El nombre es requerido'),
  customerPhone: z.string().optional(),
  reservationDate: z.string().min(1, 'La fecha es requerida'),
  reservationTime: z.string().min(1, 'La hora es requerida'),
  guestsCount: z.number().min(1, 'Debe ser al menos 1 persona'),
  notes: z.string().optional()
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  api: ApiClient;
  branchId: string;
  isOpen: boolean;
  onClose: () => void;
  reservation?: Reservation | null;
}

export function ReservationModal({ api, branchId, isOpen, onClose, reservation }: Props) {
  const { mutateAsync: createReservation, isPending: isCreating } = useCreateReservation(api, branchId);
  const { mutateAsync: updateReservation, isPending: isUpdating } = useUpdateReservation(api, branchId);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(formSchema as any),
    defaultValues: {
      guestsCount: 2
    }
  });

  useEffect(() => {
    if (isOpen) {
      if (reservation) {
        const d = new Date(reservation.reservationDate);
        reset({
          customerName: reservation.customerName,
          customerPhone: reservation.customerPhone ?? '',
          guestsCount: reservation.guestsCount,
          notes: reservation.notes ?? '',
          reservationDate: format(d, 'yyyy-MM-dd'),
          reservationTime: format(d, 'HH:mm')
        });
      } else {
        const now = new Date();
        now.setMinutes(0);
        now.setHours(now.getHours() + 1);
        reset({
          customerName: '',
          customerPhone: '',
          guestsCount: 2,
          notes: '',
          reservationDate: format(now, 'yyyy-MM-dd'),
          reservationTime: format(now, 'HH:mm')
        });
      }
    }
  }, [isOpen, reservation, reset]);

  const onSubmit = async (data: FormData) => {
    try {
      const combinedDateTime = new Date(`${data.reservationDate}T${data.reservationTime}:00`).toISOString();
      const payload = {
        customerName: data.customerName,
        customerPhone: data.customerPhone || undefined,
        guestsCount: data.guestsCount,
        notes: data.notes || undefined,
        reservationDate: combinedDateTime
      };

      if (reservation) {
        await updateReservation({ id: reservation.id, payload });
      } else {
        await createReservation(payload);
      }
      onClose();
    } catch (e) {
      console.error(e);
      alert('Error al guardar la reservación');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal ariaLabel={reservation ? "Editar Reservación" : "Nueva Reservación"} onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{reservation ? "Editar Reservación" : "Nueva Reservación"}</h2>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Nombre del Cliente</label>
          <Input
            {...register('customerName')}
            autoFocus
          />
          {errors.customerName?.message && <span style={{ color: 'var(--color-error-600, #dc2626)', fontSize: '0.75rem' }}>{errors.customerName.message}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Teléfono</label>
          <Input
            {...register('customerPhone')}
          />
          {errors.customerPhone?.message && <span style={{ color: 'var(--color-error-600, #dc2626)', fontSize: '0.75rem' }}>{errors.customerPhone.message}</span>}
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Fecha</label>
            <Input
              type="date"
              {...register('reservationDate')}
            />
            {errors.reservationDate?.message && <span style={{ color: 'var(--color-error-600, #dc2626)', fontSize: '0.75rem' }}>{errors.reservationDate.message}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Hora</label>
            <Input
              type="time"
              {...register('reservationTime')}
            />
            {errors.reservationTime?.message && <span style={{ color: 'var(--color-error-600, #dc2626)', fontSize: '0.75rem' }}>{errors.reservationTime.message}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Número de Personas</label>
          <Input
            type="number"
            min="1"
            {...register('guestsCount', { valueAsNumber: true })}
          />
          {errors.guestsCount?.message && <span style={{ color: 'var(--color-error-600, #dc2626)', fontSize: '0.75rem' }}>{errors.guestsCount.message}</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontWeight: 600, fontSize: '0.875rem' }}>Notas Especiales</label>
          <textarea
            {...register('notes')}
            rows={3}
            style={{
              padding: '0.5rem',
              borderRadius: '0.375rem',
              border: '1px solid var(--color-neutral-300)',
              fontFamily: 'inherit'
            }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={isCreating || isUpdating}>Guardar</Button>
        </div>
      </form>
    </Modal>
  );
}
