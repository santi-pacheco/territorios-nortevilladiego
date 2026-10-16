import { createContext, useContext } from 'react';
import type { Boot } from '../boot';

export const BootContext = createContext<Boot | null>(null);

export function useBoot(): Boot {
  const ctx = useContext(BootContext);
  if (!ctx) throw new Error('BootContext missing');
  return ctx;
}
