import { useCallback, useState } from 'react';
import { readPosContext, writePosContext, type PosContext } from '../lib/session';

export function usePosContextState() {
  const [posContext, setPosContext] = useState<PosContext | null>(() => readPosContext());

  const commitPosContext = useCallback((context: PosContext | null) => {
    setPosContext(context);
    writePosContext(context);
  }, []);

  return {
    commitPosContext,
    posContext
  };
}
