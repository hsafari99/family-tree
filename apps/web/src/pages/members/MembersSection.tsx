import { type InviteRole } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import type { AuthError } from '../../auth/api';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { CopyLink } from './CopyLink';
import { actionMessage, type SectionProps } from './types';

export function MembersSection({
  treeId,
  detail,
  persons,
  members,
  me,
  reload,
  acted,
  onActed,
}: SectionProps) {
  const api = useTreesApi();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  // Another action clears the link box. The first run (mount) must not: under load it can fire
  // after a click has already set the link, and would wipe it.
  const seenActed = useRef(acted.n);
  useEffect(() => {
    if (acted.n === seenActed.current) return;
    seenActed.current = acted.n;
    if (acted.from !== 'reset') setLink(null);
  }, [acted]);
  const isOwner = detail.me.role === 'owner';
  const activeSteward = detail.me.steward.active;
  const showEmail = members.some((m) => m.email !== undefined);

  const canManage = (m: (typeof members)[number]) =>
    m.role !== 'owner' && (isOwner || (activeSteward && m.invitedByUserId === me));
  const personLabel = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : '—';
  };

  async function act(
    call: () => Promise<{ ok: true } | { ok: false; error: AuthError }>,
    parts: Parameters<SectionProps['reload']>,
  ) {
    setError(null);
    const res = await call();
    if (!res.ok) return setError(actionMessage(res.error));
    onActed(null);
    await reload(...parts);
  }

  async function resetLink(userId: string, name: string) {
    setError(null);
    setLink(null);
    const res = await api.createResetLink(treeId, userId);
    if (!res.ok) return setError(actionMessage(res.error));
    setLink({ name, url: `${window.location.origin}/reset/${res.data.token}` });
    onActed('reset');
  }

  return (
    <section>
      <h2>Members</h2>
      <FormError>{error}</FormError>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            {showEmail && <th>Email</th>}
            <th>Their card</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.name}
                {m.userId === me && ' (you)'}
              </td>
              <td>
                {canManage(m) ? (
                  <select
                    aria-label={`Role for ${m.name}`}
                    value={m.role}
                    onChange={(e) =>
                      void act(
                        () => api.changeRole(treeId, m.userId, e.target.value as InviteRole),
                        ['members'],
                      )
                    }
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }[m.role]
                )}
              </td>
              {showEmail && <td>{m.email ?? ''}</td>}
              <td>{personLabel(m.personId)}</td>
              <td>
                {canManage(m) && (
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Remove from tree"
                    danger
                    onConfirm={() =>
                      void act(
                        () => api.removeMember(treeId, m.userId),
                        ['members', 'stewards', 'invites'],
                      )
                    }
                  />
                )}
                {isOwner && m.role !== 'owner' && (
                  <>
                    {m.twoFactorEnabled ? (
                      <ConfirmButton
                        label="Make owner"
                        confirmLabel="Transfer ownership"
                        onConfirm={() =>
                          void act(
                            () => api.transferOwnership(treeId, m.userId),
                            ['tree', 'members', 'stewards', 'invites'],
                          )
                        }
                      />
                    ) : (
                      <>
                        <span className="hint">Needs two-step verification to become owner</span>{' '}
                        <button type="button" onClick={() => void resetLink(m.userId, m.name)}>
                          Reset link
                        </button>
                      </>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {link && (
        <CopyLink label="Reset link" url={link.url}>
          Send this link to {link.name} yourself. It works once, for 24 hours.
        </CopyLink>
      )}
    </section>
  );
}
