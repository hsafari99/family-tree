import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { type Result, SESSION_EXPIRED } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { TREES_API_METHODS, type TreesApi } from './api';

const TreesApiContext = createContext<TreesApi | null>(null);

/** Wraps every method so a "session expired" result re-reads the session, like AuthProvider does. */
function watchSession(api: TreesApi, onExpired: () => void): TreesApi {
  const wrapped: Record<string, unknown> = {};
  for (const key of TREES_API_METHODS) {
    const method = api[key] as (...args: unknown[]) => Promise<Result<unknown>>;
    wrapped[key] = async (...args: unknown[]) => {
      const res = await method.apply(api, args);
      if (!res.ok && res.error.code === SESSION_EXPIRED) onExpired();
      return res;
    };
  }
  return wrapped as unknown as TreesApi;
}

export function TreesApiProvider({ api, children }: { api: TreesApi; children: ReactNode }) {
  const { refresh } = useAuth();
  const wrapped = useMemo(() => watchSession(api, () => void refresh()), [api, refresh]);
  return <TreesApiContext.Provider value={wrapped}>{children}</TreesApiContext.Provider>;
}

export function useTreesApi(): TreesApi {
  const ctx = useContext(TreesApiContext);
  if (!ctx) throw new Error('useTreesApi must be used inside <TreesApiProvider>');
  return ctx;
}
