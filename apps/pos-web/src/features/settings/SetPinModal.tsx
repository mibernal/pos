import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal, Button, Input, Label, Banner } from '../../components/ui';

interface SetPinModalProps {
  api: any;
  isOpen: boolean;
  onClose: () => void;
}

export function SetPinModal({ api, isOpen, onClose }: SetPinModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newPin: string) => {
      // Usar fetch directo o un helper genérico ya que api.client no existe directamente, 
      // pero podemos usar el mismo baseUrl y fetch. O api.requestJson si lo expusiera.
      // Ya que no tenemos un endpoint específico expuesto en api, usamos fetch:
      const token = api.getAccessToken();
      const res = await fetch(`${api.baseUrl}/auth/profile/pin`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ new_pin: newPin })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Error al guardar el PIN');
      }
    },
    onSuccess: () => {
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setPin('');
        setConfirmPin('');
        onClose();
      }, 2000);
    },
    onError: (err: any) => {
      setError(err?.message || 'Error al guardar el PIN. Intenta nuevamente.');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (pin.length < 4 || pin.length > 10) {
      setError('El PIN debe tener entre 4 y 10 caracteres.');
      return;
    }
    if (pin !== confirmPin) {
      setError('Los PINs no coinciden.');
      return;
    }

    mutation.mutate(pin);
  };

  if (!isOpen) return null;

  return (
    <Modal ariaLabel="Configurar PIN de Aprobación" onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-4">Configurar PIN de Aprobación</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-gray-500 mb-4">
            Este PIN será requerido para aprobar operaciones críticas como conciliaciones de inventario con discrepancias.
          </p>

          {error && <Banner tone="error">{error}</Banner>}
          {success && <Banner tone="success">PIN configurado correctamente.</Banner>}

          <div className="space-y-2">
            <Label htmlFor="pin">Nuevo PIN</Label>
            <Input
              id="pin"
              type="password"
              value={pin}
              onChange={(e: any) => setPin(e.target.value)}
              placeholder="Min 4 caracteres"
              required
              disabled={mutation.isPending || success}
            />
          </div>

          <div className="space-y-2 mt-4">
            <Label htmlFor="confirmPin">Confirmar PIN</Label>
            <Input
              id="confirmPin"
              type="password"
              value={confirmPin}
              onChange={(e: any) => setConfirmPin(e.target.value)}
              placeholder="Repite el PIN"
              required
              disabled={mutation.isPending || success}
            />
          </div>

          <div className="flex justify-end space-x-2 mt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending || success || !pin || !confirmPin}>
              {mutation.isPending ? 'Guardando...' : 'Guardar PIN'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
