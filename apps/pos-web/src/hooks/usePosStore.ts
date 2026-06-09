import { create } from 'zustand';
import { readPosContext, writePosContext, type PosContext } from '../lib/session';

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
    writePosContext(context);
    set({ posContext: context });
  },

  isUpgradeModalOpen: false,
  upgradeModalMessage: null,
  openUpgradeModal: (message) => set({ isUpgradeModalOpen: true, upgradeModalMessage: message }),
  closeUpgradeModal: () => set({ isUpgradeModalOpen: false, upgradeModalMessage: null })
}));
