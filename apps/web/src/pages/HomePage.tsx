import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Page';
import { HealthStatus } from '../HealthStatus';
import { MyTrees } from './MyTrees';

/** Home: the signed-in user's trees. RequireAuth sends everyone else to sign in. */
export function HomePage() {
  const { user, loadError, signOut } = useAuth();
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
      {loadError && (
        <p role="status" className="notice">
          Can’t reach the server right now
        </p>
      )}
      {user && user !== 'loading' && (
        <>
          <p>Signed in as {user.name}</p>
          <div className="actions">
            <Link to="/account">Account settings</Link>
            <button type="button" onClick={onSignOut} disabled={pending}>
              Sign out
            </button>
          </div>
          <h2>Your trees</h2>
          <MyTrees />
        </>
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
