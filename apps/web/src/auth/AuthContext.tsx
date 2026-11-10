import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type AuthApi,
  type AuthError,
  type Result,
  SESSION_EXPIRED,
  type SessionUser,
} from './api';

export type UserState = SessionUser | null | 'loading';

interface AuthContextValue {
  api: AuthApi;
  user: UserState;
  /** Set when the last attempt to read the user failed (for example the API is unreachable). */
  loadError: AuthError | null;
  /** Re-reads the signed-in user from the server. */
  refresh(): Promise<void>;
  signOut(): Promise<Result<void>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Every AuthApi method; the Record type makes the compiler flag a missing one. */
const METHODS = Object.keys({
  getMe: true,
  signUp: true,
  signIn: true,
  verifyTotp: true,
  verifyRecoveryCode: true,
  signOut: true,
  startTwoFactorSetup: true,
  confirmTwoFactorSetup: true,
  regenerateRecoveryCodes: true,
  disableTwoFactor: true,
  changePassword: true,
  resetWithCode: true,
  resetWithLink: true,
  deleteAccount: true,
} satisfies Record<keyof AuthApi, true>) as (keyof AuthApi)[];

/**
 * Wraps every AuthApi method so a "session expired" result calls `onExpired`, which re-reads
 * the session (and so sends the user to sign in if it really is gone).
 */
function watchSession(api: AuthApi, onExpired: () => void): AuthApi {
  const wrapped: Record<string, unknown> = {};
  for (const key of METHODS) {
    const method = api[key] as (...args: unknown[]) => Promise<Result<unknown>>;
    wrapped[key] = async (...args: unknown[]) => {
      const res = await method.apply(api, args);
      if (!res.ok && res.error.code === SESSION_EXPIRED) onExpired();
      return res;
    };
  }
  return wrapped as unknown as AuthApi;
}

export function AuthProvider({ api: rawApi, children }: { api: AuthApi; children: ReactNode }) {
  const [user, setUser] = useState<UserState>('loading');
  const [loadError, setLoadError] = useState<AuthError | null>(null);
  const active = useRef(true);

  const refresh = useCallback(async () => {
    const res = await rawApi.getMe();
    if (!active.current) return;
    if (res.ok) {
      // A real answer: signed in as someone, or signed out (null).
      setUser(res.data);
      setLoadError(null);
    } else {
      // A transient failure (network, 5xx): keep whoever was signed in. Only the very first
      // load, with nobody known yet, falls back to signed out.
      setUser((prev) => (prev === 'loading' ? null : prev));
      setLoadError(res.error);
    }
  }, [rawApi]);

  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
    };
  }, [refresh]);

  const api = useMemo(() => watchSession(rawApi, () => void refresh()), [rawApi, refresh]);

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
