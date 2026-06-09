import { useState } from 'react';
import { usePosStore } from '../../../hooks/usePosStore';
import { Button, Modal } from '../../../components/ui';

export function UpgradePlanModal() {
  const { isUpgradeModalOpen, upgradeModalMessage, closeUpgradeModal } = usePosStore();
  const [isNavigating, setIsNavigating] = useState(false);

  if (!isUpgradeModalOpen) return null;

  const handleNavigateToBilling = () => {
    setIsNavigating(true);
    closeUpgradeModal();
    // Use window.location as fallback if we don't pass the router context,
    // or you could dispatch an event, but reload/location.assign works fine for POS apps.
    window.location.hash = '#/billing'; 
  };

  return (
    <Modal ariaLabel="Límite del Plan Alcanzado" onClose={closeUpgradeModal}>
      <div className="space-y-4 p-4">
        <h2 className="text-xl font-bold text-foreground">Límite del Plan Alcanzado</h2>
        <p className="text-gray-700">
          {upgradeModalMessage || 'Has alcanzado los límites de tu plan actual. Por favor, mejora tu plan para continuar utilizando esta funcionalidad.'}
        </p>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={closeUpgradeModal}>
            Cerrar
          </Button>
          <Button variant="default" onClick={handleNavigateToBilling} disabled={isNavigating}>
            {isNavigating ? 'Redirigiendo...' : 'Ver Planes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
