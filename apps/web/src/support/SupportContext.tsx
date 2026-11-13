import { createContext, type ReactNode, useContext } from 'react';
import { SUPPORT, type SupportConfig } from './config';

const SupportContext = createContext<SupportConfig>(SUPPORT);

/** Overrides the build's support options (tests). */
export function SupportProvider({
  value,
  children,
}: {
  value: SupportConfig;
  children: ReactNode;
}) {
  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export const useSupport = () => useContext(SupportContext);
