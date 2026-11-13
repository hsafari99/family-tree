import type { CreatedInvite, Invite, PersonSummary, TreeDetail } from '@family-tree/shared';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { describeInvite, InviteForm, InviteLink, mayRevoke } from '../members/InviteForm';
import { actionMessage } from '../members/types';

/**
 * The invite dialog for one person (`?tab=invite` on their page): their open invite, if there is
 * one (its link was shown once, so it can only be revoked), else a form with them as the target.
 */
export function InvitePerson({
  treeId,
  detail,
  persons,
  person,
  invites,
  onChanged,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  person: PersonSummary;
  /** The open invites the viewer can see. */
  invites: Invite[];
  /** After an invite is made or revoked: reload the invites. */
  onChanged: () => void;
}) {
  const api = useTreesApi();
  const { user } = useAuth();
  const me = user && user !== 'loading' ? user.id : '';
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = invites.filter((i) => i.targetPersonId === person.id && i.id !== created?.id);
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'someone';
  };

  async function revoke(id: string) {
    setError(null);
    const res = await api.revokeInvite(treeId, id);
    if (!res.ok) return setError(actionMessage(res.error));
    onChanged();
  }

  if (created) {
    return (
      <>
        <p role="status" className="success">
          Invite created.
        </p>
        <InviteLink created={created} />
      </>
    );
  }
  if (open.length > 0) {
    return (
      <>
        <FormError>{error}</FormError>
        <p>
          {personName(person)} already has an open invite. Its link was shown once, when it was
          made; if it got lost, revoke it and make a new one.
        </p>
        <ul aria-label={`Open invites for ${personName(person)}`}>
          {open.map((i) => (
            <li key={i.id}>
              {describeInvite(i, nameOf)}{' '}
              {mayRevoke(detail, me, i) && (
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Revoke invite"
                  danger
                  onConfirm={() => void revoke(i.id)}
                />
              )}
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <InviteForm
      treeId={treeId}
      detail={detail}
      persons={persons}
      target={person}
      onCreated={(c) => {
        setCreated(c);
        onChanged();
      }}
    />
  );
}
