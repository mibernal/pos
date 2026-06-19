import { create } from 'zustand';

interface DeliveriesState {
  isCreateDeliveryModalOpen: boolean;
  openCreateDeliveryModal: () => void;
  closeCreateDeliveryModal: () => void;
  
  isAssignDriverModalOpen: boolean;
  deliveryIdForDriver: string | null;
  openAssignDriverModal: (deliveryId: string) => void;
  closeAssignDriverModal: () => void;
}

export const useDeliveriesStore = create<DeliveriesState>((set) => ({
  isCreateDeliveryModalOpen: false,
  openCreateDeliveryModal: () => set({ isCreateDeliveryModalOpen: true }),
  closeCreateDeliveryModal: () => set({ isCreateDeliveryModalOpen: false }),

  isAssignDriverModalOpen: false,
  deliveryIdForDriver: null,
  openAssignDriverModal: (deliveryId: string) => set({ isAssignDriverModalOpen: true, deliveryIdForDriver: deliveryId }),
  closeAssignDriverModal: () => set({ isAssignDriverModalOpen: false, deliveryIdForDriver: null })
}));
