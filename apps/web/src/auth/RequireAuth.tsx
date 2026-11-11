import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Renders its children for a signed-in user; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === 'loading') return <p className="status">Loading…</p>;
  if (user === null) {
    const next = `${location.pathname}${location.search}`;
    // Home is where sign-in goes anyway, so it needs no `next`.
    const to = next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

export { safeNext } from './safe-next';
