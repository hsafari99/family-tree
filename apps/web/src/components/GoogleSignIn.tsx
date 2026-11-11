import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { FormError } from './forms';

/** Whether Google sign-in is on (asked once per mount; false until known or on failure). */
export function useGoogleEnabled(): boolean {
  return useGoogleAvailability() ?? false;
}

/** Whether the server offers Google sign-in; null until it has answered. */
export function useGoogleAvailability(): boolean | null {
  const { api } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void api.getProviders().then((res) => {
      if (active) setEnabled(res.ok ? res.data.google : false);
    });
    return () => {
      active = false;
    };
  }, [api]);
  return enabled;
}

/** Google's "G", decorative: the button's text names it. */
export function GoogleLogo() {
  return (
    <svg className="google-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google", shown only when Google sign-in is on. `next` must already be a safe
 * path on this site (pages pass safeNext's result); the server checks it again.
 */
export function GoogleSignIn({ next }: { next: string }) {
  const { api } = useAuth();
  const enabled = useGoogleEnabled();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coming back with the browser's Back button restores this page from the cache, still busy.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setPending(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  if (!enabled) return null;

  async function start() {
    setError(null);
    setPending(true);
    const res = await api.startGoogleSignIn({ next });
    // On success the page is leaving for Google; stay busy until it does.
    if (!res.ok) {
      setPending(false);
      setError(res.error.message);
    }
  }

  return (
    <div className="alt-sign-in">
      <p className="divider" aria-hidden="true">
        <span>or</span>
      </p>
      <button type="button" className="google" disabled={pending} onClick={() => void start()}>
        <GoogleLogo />
        {pending ? 'Opening Google…' : 'Continue with Google'}
      </button>
      <FormError>{error}</FormError>
    </div>
  );
}
