import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext';

/** Renders its children for a signed-in user; otherwise sends them to sign in and back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, signedOut } = useAuth();
  const location = useLocation();

  if (user === 'loading') return <p className="status">Loading…</p>;
  if (user === null) {
    const next = `${location.pathname}${location.search}`;
    // Home is where sign-in goes anyway, so it needs no `next`; nor does signing out on purpose
    // (whoever signs in next shouldn't land on the last user's page).
    const to = next === '/' || signedOut ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
    return <Navigate to={to} replace />;
  }
  return <>{children}</>;
}

export { safeNext } from './safe-next';
