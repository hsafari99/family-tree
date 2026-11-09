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

/**
 * A `next` value is only followed when it resolves to a path on this site. Control characters
 * and backslashes are rejected up front: browsers strip tabs and newlines from URLs, so
 * "/\t/evil.example" would otherwise become "//evil.example".
 */
export function safeNext(next: string | null): string {
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(next)) return '/';
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
