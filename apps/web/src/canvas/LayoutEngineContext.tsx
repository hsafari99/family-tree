import { createContext, type ReactNode, useContext } from 'react';
import type { LayoutEngine } from './layout-engine';

const Ctx = createContext<LayoutEngine | null>(null);

export function LayoutEngineProvider({
  engine,
  children,
}: {
  engine: LayoutEngine;
  children: ReactNode;
}) {
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useLayoutEngine(): LayoutEngine {
  const engine = useContext(Ctx);
  if (!engine) throw new Error('useLayoutEngine must be used inside <LayoutEngineProvider>');
  return engine;
}
