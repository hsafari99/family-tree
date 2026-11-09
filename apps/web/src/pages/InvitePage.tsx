import type { InvitePreview } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { FormError } from '../components/forms';
import { Page } from '../components/Page';
import { useTreesApi } from '../trees/TreesApiContext';

/** Public landing page for an invite link. The token comes from the URL and goes only to the API. */
export function InvitePage() {
  const { token = '' } = useParams();
  const api = useTreesApi();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.previewInvite(token).then((res) => {
      if (!active) return;
      if (res.ok) setPreview(res.data);
      else setError(res.error.message);
    });
    return () => {
      active = false;
    };
  }, [api, token]);

  async function join() {
    setJoinError(null);
    setPending(true);
    const res = await api.acceptInvite(token);
    setPending(false);
    if (!res.ok) {
      setJoinError(res.error.message);
      return;
    }
    void navigate(`/trees/${res.data.treeId}`);
  }

  const title = 'You’re invited';
  if (error) {
    return (
      <Page title={title}>
        <FormError>{error}</FormError>
        <p>
          <Link to="/">Go to Family Tree</Link>
        </p>
      </Page>
    );
  }
  if (!preview || user === 'loading') {
    return (
      <Page title={title}>
        <p>Loading…</p>
      </Page>
    );
  }

  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <Page title={title}>
      <p>
        {preview.inviterName} invited you to {preview.treeName} as{' '}
        {preview.role === 'editor' ? 'an editor' : 'a viewer'}.
      </p>
      {preview.steward && (
        <p>
          They&apos;d also like you to look after a branch of the family. That needs two-step
          verification.
        </p>
      )}
      {preview.targetPersonName && (
        <p>The invite says you are {preview.targetPersonName} in the tree.</p>
      )}
      {user ? (
        <>
          <p>Signed in as {user.name}</p>
          <FormError>{joinError}</FormError>
          <button type="button" disabled={pending} onClick={() => void join()}>
            Join {preview.treeName}
          </button>
        </>
      ) : (
        <div className="actions">
          <Link to={`/sign-in?next=${next}`}>Sign in</Link>
          <Link to={`/sign-up?next=${next}`}>Create an account</Link>
        </div>
      )}
    </Page>
  );
}
