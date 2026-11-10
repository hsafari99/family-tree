import type { CreatedInvite, Invite } from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { CopyLink } from './CopyLink';
import { actionMessage, type SectionProps } from './types';

export function InvitesSection({
  treeId,
  detail,
  persons,
  members,
  me,
  reload,
  acted,
  onActed,
  invites,
}: SectionProps & { invites: Invite[] }) {
  const api = useTreesApi();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [anchorId, setAnchorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [pending, setPending] = useState(false);
  // Skip the mount run: under load it can fire after a click has already set `created`.
  const seenActed = useRef(acted.n);
  useEffect(() => {
    if (acted.n === seenActed.current) return;
    seenActed.current = acted.n;
    if (acted.from !== 'invite') setCreated(null);
  }, [acted]);
  const isOwner = detail.me.role === 'owner';
  const linked = new Set(members.map((m) => m.personId).filter(Boolean));
  const unlinked = persons.filter((p) => !linked.has(p.id));
  // A steward's anchor must be inside their branch: offer their own anchors (always in scope).
  const anchorOptions = isOwner
    ? persons
    : persons.filter((p) => detail.me.steward.grants.some((g) => g.anchorPersonId === p.id));
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'someone';
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setPending(true);
    const res = await api.createInvite(treeId, {
      role,
      stewardAnchorPersonId: anchorId || null,
      targetPersonId: targetId || null,
    });
    setPending(false);
    if (!res.ok) {
      setError(
        res.error.code === 'FORBIDDEN'
          ? 'You can only invite people into your own branch'
          : actionMessage(res.error),
      );
      return;
    }
    setCreated(res.data);
    onActed('invite');
    await reload('invites');
  }

  async function revoke(id: string) {
    setError(null);
    const res = await api.revokeInvite(treeId, id);
    if (!res.ok) return setError(actionMessage(res.error));
    onActed(null);
    await reload('invites');
  }

  return (
    <section>
      <h2>Invite someone</h2>
      <FormError>{error}</FormError>
      <form onSubmit={create}>
        <fieldset>
          <legend>Role</legend>
          <label>
            <input
              type="radio"
              name="invite-role"
              checked={role === 'viewer'}
              onChange={() => setRole('viewer')}
            />{' '}
            Can view
          </label>{' '}
          <label>
            <input
              type="radio"
              name="invite-role"
              checked={role === 'editor'}
              onChange={() => setRole('editor')}
            />{' '}
            Can add and edit
          </label>
        </fieldset>
        <div className="field">
          <label htmlFor="invite-anchor">Make them a steward of</label>
          <select id="invite-anchor" value={anchorId} onChange={(e) => setAnchorId(e.target.value)}>
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
          <select id="invite-target" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">No one in particular</option>
            {unlinked.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending}>
          Create invite link
        </button>
      </form>
      {created && (
        <CopyLink label="Invite link" url={`${window.location.origin}/invite/${created.token}`}>
          Send this link to them yourself, by message or email. It works once and expires on{' '}
          {new Date(created.expiresAt).toLocaleDateString()}. You won&apos;t be able to see this
          link again.
        </CopyLink>
      )}
      <h3>Open invites</h3>
      {invites.length === 0 ? (
        <p>No open invites.</p>
      ) : (
        <ul>
          {invites.map((i) => (
            <li key={i.id}>
              {i.role === 'editor' ? 'Can add and edit' : 'Can view'}
              {i.stewardAnchorPersonId && `, steward of ${nameOf(i.stewardAnchorPersonId)}`}
              {i.targetPersonId && `, for ${nameOf(i.targetPersonId)}`}, created by{' '}
              {i.createdByName}, expires {new Date(i.expiresAt).toLocaleDateString()}{' '}
              {(isOwner || (detail.me.steward.active && i.createdByUserId === me)) && (
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
      )}
    </section>
  );
}
