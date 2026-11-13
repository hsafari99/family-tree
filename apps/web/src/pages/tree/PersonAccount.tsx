import type { Ref } from 'react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FormError } from '../../components/forms';
import { UserIcon } from '../../components/icons';
import type { InviteState } from '../../canvas/account-links';
import { useTreesApi } from '../../trees/TreesApiContext';

/**
 * Under a person's name in the panel: whose account they are, or what can be done about it: an
 * invite for them (for whoever may invite), and "This is me" for a member with no card yet.
 */
export function PersonAccount({
  treeId,
  personId,
  name,
  given,
  linkedName,
  invite,
  canClaim,
  onInvite,
  inviteRef,
  onClaimed,
}: {
  treeId: string;
  personId: string;
  name: string;
  given: string;
  /** The member linked to this person, unless it is you. */
  linkedName: string | null;
  invite: InviteState;
  /** The signed-in member has no card and this person is no one's. */
  canClaim: boolean;
  onInvite: () => void;
  inviteRef?: Ref<HTMLButtonElement>;
  onClaimed: () => void;
}) {
  const api = useTreesApi();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setPending(true);
    setError(null);
    const res = await api.claimPerson(treeId, personId);
    setPending(false);
    setAsking(false);
    if (!res.ok) return setError(res.error.message);
    onClaimed();
  }

  if (linkedName) {
    return (
      <p className="person-account">
        <UserIcon /> Linked to {linkedName}’s account
      </p>
    );
  }
  if (!invite && !canClaim) return null;
  return (
    <div className="person-account">
      <FormError>{error}</FormError>
      {invite === 'pending' && <span className="hint">Invite pending</span>}
      {invite && (
        <button
          type="button"
          className="link-button"
          aria-haspopup="dialog"
          ref={inviteRef}
          onClick={onInvite}
        >
          {invite === 'pending' ? 'View invite…' : `Invite ${given}…`}
        </button>
      )}
      {canClaim && (
        <button
          type="button"
          className="link-button"
          aria-haspopup="dialog"
          onClick={() => setAsking(true)}
        >
          This is me
        </button>
      )}
      <ConfirmDialog
        open={asking}
        title={`Are you ${name}?`}
        confirmLabel="Yes, this is me"
        pending={pending}
        onCancel={() => setAsking(false)}
        onConfirm={() => void claim()}
      >
        <p>
          This card will show you as “You”, and the tree will open on it. Only the tree’s owner can
          change it afterwards.
        </p>
      </ConfirmDialog>
    </div>
  );
}
