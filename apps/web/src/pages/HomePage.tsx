import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';
import { HealthStatus } from '../HealthStatus';

export function HomePage() {
  const { user, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSignOut() {
    setPending(true);
    setError(null);
    const res = await signOut();
    setPending(false);
    if (!res.ok) setError(res.error.message);
  }

  return (
    <Page title="Family Tree">
      {user === 'loading' ? (
        <p>Loading…</p>
      ) : user ? (
        <>
          <p>Signed in as {user.name}</p>
          <div className="actions">
            <Link to="/account">Account settings</Link>
            <button type="button" onClick={onSignOut} disabled={pending}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          <Link to="/sign-in">Sign in</Link>
          <Link to="/sign-up">Create an account</Link>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <HealthStatus />
    </Page>
  );
}
