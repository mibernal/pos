import { create } from 'zustand';
import { readPosContext, writePosContext, type PosContext } from '../lib/session';
import { useCartStore } from '../features/sales/hooks/useCartStore';

interface PosState {
  posContext: PosContext | null;
  commitPosContext: (context: PosContext | null) => void;
  
  // UI Global State
  isUpgradeModalOpen: boolean;
  upgradeModalMessage: string | null;
  openUpgradeModal: (message: string) => void;
  closeUpgradeModal: () => void;
}

export const usePosStore = create<PosState>((set) => ({
  posContext: readPosContext(),
  commitPosContext: (context) => {
    set((state) => {
      // If branch or terminal changes, clear the cart to prevent state leakage
      if (
        state.posContext?.branchId !== context?.branchId ||
        state.posContext?.terminalId !== context?.terminalId
      ) {
        useCartStore.getState().resetCart();
      }
      writePosContext(context);
      return { posContext: context };
    });
  },

  isUpgradeModalOpen: false,
  upgradeModalMessage: null,
  openUpgradeModal: (message) => set({ isUpgradeModalOpen: true, upgradeModalMessage: message }),
  closeUpgradeModal: () => set({ isUpgradeModalOpen: false, upgradeModalMessage: null })
}));
