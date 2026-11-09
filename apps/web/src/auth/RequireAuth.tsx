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
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

/** A `next` value is only followed when it is a path on this site ("/x", never "//x"). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  return next;
}
