import type { CreatedInvite, Invite, PersonSummary, TreeDetail } from '@family-tree/shared';
import { type FormEvent, useId, useState } from 'react';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { CopyLink } from './CopyLink';
import { actionMessage } from './types';

type Choice = 'viewer' | 'editor' | 'steward';

/**
 * Making an invite link: the Members page's general form, or one for a given person (from their
 * card or panel). With `target`, the invite is for that person and can make them a steward of
 * their own branch, the default when the inviter may grant stewardship.
 */
export function InviteForm({
  treeId,
  detail,
  persons,
  candidates = [],
  target,
  onCreated,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  /** People an untargeted invite may be for: no member is linked to them. */
  candidates?: PersonSummary[];
  target?: PersonSummary;
  onCreated: (created: CreatedInvite) => void;
}) {
  const api = useTreesApi();
  const canSteward = detail.capabilities.grantStewardship;
  const [choice, setChoice] = useState<Choice>(
    target ? (canSteward ? 'steward' : 'editor') : 'viewer',
  );
  const [anchorId, setAnchorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const hintId = useId();
  const isOwner = detail.me.role === 'owner';
  // A steward's anchor must be inside their branch: offer their own anchors (always in scope).
  const anchorOptions = isOwner
    ? persons
    : persons.filter((p) => detail.me.steward.grants.some((g) => g.anchorPersonId === p.id));
  const given = target ? target.givenName || personName(target) : '';

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await api.createInvite(
      treeId,
      target
        ? {
            // A steward's base role is "view": they edit inside their branch only.
            role: choice === 'editor' ? 'editor' : 'viewer',
            stewardAnchorPersonId: choice === 'steward' ? target.id : null,
            targetPersonId: target.id,
          }
        : {
            role: choice === 'editor' ? 'editor' : 'viewer',
            stewardAnchorPersonId: anchorId || null,
            targetPersonId: targetId || null,
          },
    );
    setPending(false);
    if (!res.ok) {
      setError(
        res.error.code === 'FORBIDDEN'
          ? 'You can only invite people into your own branch'
          : res.error.fields?.includes('targetPersonId')
            ? 'Someone has already joined as this person'
            : actionMessage(res.error),
      );
      return;
    }
    onCreated(res.data);
  }

  const radio = (value: Choice, label: string) => (
    <label>
      <input
        type="radio"
        name={target ? 'person-invite-role' : 'invite-role'}
        checked={choice === value}
        onChange={() => setChoice(value)}
        {...(value === 'steward' ? { 'aria-describedby': hintId } : {})}
      />{' '}
      {label}
    </label>
  );

  return (
    <form onSubmit={create} aria-label={target ? `Invite ${personName(target)}` : undefined}>
      <FormError>{error}</FormError>
      {target && (
        <p>
          This invite is for <strong>{personName(target)}</strong>. When they join, their card
          becomes theirs and the tree opens on it.
        </p>
      )}
      <fieldset>
        <legend>Role</legend>
        {target && canSteward && <>{radio('steward', `Steward of ${given}’s branch`)} </>}
        {target ? (
          <>
            {radio('editor', 'Can add and edit')} {radio('viewer', 'Can view')}
          </>
        ) : (
          <>
            {radio('viewer', 'Can view')} {radio('editor', 'Can add and edit')}
          </>
        )}
        {target && canSteward && (
          <p id={hintId} className="hint">
            A steward can add and edit {given} and their family below, and view the rest. It starts
            once they turn on two-step verification.
          </p>
        )}
      </fieldset>
      {!target && (
        <>
          <div className="field">
            <label htmlFor="invite-anchor">Make them a steward of</label>
            <select
              id="invite-anchor"
              value={anchorId}
              onChange={(e) => setAnchorId(e.target.value)}
            >
              <option value="">No</option>
              {anchorOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="invite-target">This invite is for</label>
            <select
              id="invite-target"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">No one in particular</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <button type="submit" disabled={pending}>
        Create invite link
      </button>
    </form>
  );
}

/** The link of an invite just made: shown once, so it says so. */
export function InviteLink({ created }: { created: CreatedInvite }) {
  return (
    <CopyLink label="Invite link" url={`${window.location.origin}/invite/${created.token}`}>
      Send this link to them yourself, by message or email. It works once and expires on{' '}
      {new Date(created.expiresAt).toLocaleDateString()}. You won&apos;t be able to see this link
      again.
    </CopyLink>
  );
}

/** "Can view, steward of Ann, for Leo, created by Ada, expires 1/2/2027". */
export function describeInvite(i: Invite, nameOf: (id: string | null) => string): string {
  return [
    i.role === 'editor' ? 'Can add and edit' : 'Can view',
    i.stewardAnchorPersonId && `steward of ${nameOf(i.stewardAnchorPersonId)}`,
    i.targetPersonId && `for ${nameOf(i.targetPersonId)}`,
    `created by ${i.createdByName}`,
    `expires ${new Date(i.expiresAt).toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** Whether the viewer may revoke the invite: the owner any, an active steward their own. */
export const mayRevoke = (detail: TreeDetail, me: string, i: Invite) =>
  detail.me.role === 'owner' || (detail.me.steward.active && i.createdByUserId === me);
