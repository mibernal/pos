import { create } from 'zustand';
import { readPosContext, writePosContext, type PosContext } from '../lib/session';

interface PosState {
  posContext: PosContext | null;
  commitPosContext: (context: PosContext | null) => void;
  // Podríamos mover más cosas aquí en el futuro (ej: sync states)
}

export const usePosStore = create<PosState>((set) => ({
  posContext: readPosContext(),
  commitPosContext: (context) => {
    writePosContext(context);
    set({ posContext: context });
  },
}));
