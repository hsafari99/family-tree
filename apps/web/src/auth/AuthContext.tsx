import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthApi, AuthError, Result, SessionUser } from './api';

export type UserState = SessionUser | null | 'loading';

interface AuthContextValue {
  api: AuthApi;
  user: UserState;
  /** Set when loading the user failed (for example the API is unreachable). */
  loadError: AuthError | null;
  /** Re-reads the signed-in user from the server. */
  refresh(): Promise<void>;
  signOut(): Promise<Result<void>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ api, children }: { api: AuthApi; children: ReactNode }) {
  const [user, setUser] = useState<UserState>('loading');
  const [loadError, setLoadError] = useState<AuthError | null>(null);

  const refresh = useCallback(async () => {
    const res = await api.getMe();
    if (res.ok) {
      setUser(res.data);
      setLoadError(null);
    } else {
      setUser(null);
      setLoadError(res.error);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    void api.getMe().then((res) => {
      if (!active) return;
      setUser(res.ok ? res.data : null);
      setLoadError(res.ok ? null : res.error);
    });
    return () => {
      active = false;
    };
  }, [api]);

  const signOut = useCallback(async () => {
    const res = await api.signOut();
    if (res.ok) setUser(null);
    return res;
  }, [api]);

  return (
    <AuthContext.Provider value={{ api, user, loadError, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
