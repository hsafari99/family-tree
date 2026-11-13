import { type InviteRole } from '@family-tree/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { AuthError } from '../../auth/api';
import { ConfirmButton } from '../../components/ConfirmButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MenuButton, type MenuItem } from '../../components/MenuButton';
import { FormError } from '../../components/forms';
import { personName, ROLE_LABEL } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { CopyLink } from './CopyLink';
import { actionMessage, type SectionProps } from './types';
import { EmptyState } from '../../components/EmptyState';
import { UsersIcon } from '../../components/icons';

const COLUMNS = ['Name', 'Role', 'Branch / steward scope', 'Joined', 'Actions'] as const;

export function MembersSection({
  treeId,
  detail,
  persons,
  members,
  me,
  reload,
  acted,
  onActed,
  stewards,
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
  const [transferTo, setTransferTo] = useState<string | null>(null);
  // Linking a member to a person card (owner only): whose link, and the person chosen.
  const [linking, setLinking] = useState<{ userId: string; personId: string } | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const captionId = useId();
  const linkSelectId = useId();

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

  const grantsOf = (userId: string) => stewards.filter((g) => g.userId === userId);
  const transferTarget = members.find((m) => m.userId === transferTo) ?? null;
  const linkTarget = members.find((m) => m.userId === linking?.userId) ?? null;
  const unlinkTarget = members.find((m) => m.userId === unlinking) ?? null;
  // A member can be linked to anyone no other member has (or keep the card they have).
  const linkOptions = persons.filter(
    (p) => !members.some((o) => o.personId === p.id && o.userId !== linking?.userId),
  );

  return (
    <section>
      <h2>Members</h2>
      <FormError>{error}</FormError>
      <div className="table-wrap">
        <table className="data members-table" aria-labelledby={captionId}>
          <caption id={captionId} className="sr-only">
            Members of {detail.tree.name}
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const grants = grantsOf(m.userId);
              const card = m.personId ? personLabel(m.personId) : null;
              const linkItems: MenuItem[] = isOwner
                ? [
                    {
                      label: card ? 'Change linked person…' : 'Link to a person…',
                      onSelect: () => setLinking({ userId: m.userId, personId: m.personId ?? '' }),
                    },
                    ...(card
                      ? [{ label: `Unlink from ${card}`, onSelect: () => setUnlinking(m.userId) }]
                      : []),
                  ]
                : [];
              const more: MenuItem[] = [
                ...linkItems,
                ...(isOwner && m.role !== 'owner'
                  ? m.twoFactorEnabled
                    ? [{ label: 'Make owner', onSelect: () => setTransferTo(m.userId) }]
                    : [
                        {
                          label: 'Make owner (needs two-step verification)',
                          disabled: true,
                          onSelect: () => {},
                        },
                        { label: 'Reset link', onSelect: () => void resetLink(m.userId, m.name) },
                      ]
                  : []),
              ];
              return (
                <tr key={m.userId}>
                  <td data-label={COLUMNS[0]}>
                    <div className="cell">
                      <span className="member-name">{m.name}</span>
                      {m.userId === me && (
                        <>
                          {' '}
                          <span className="badge pill">You</span>
                        </>
                      )}
                      {m.email !== undefined && <div className="row-meta">{m.email}</div>}
                    </div>
                  </td>
                  <td data-label={COLUMNS[1]}>
                    <div className="cell">
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
                        ROLE_LABEL[m.role]
                      )}
                    </div>
                  </td>
                  <td data-label={COLUMNS[2]}>
                    <div className="cell">
                      {grants.map((g) => (
                        <div key={g.id}>
                          Steward of {personLabel(g.anchorPersonId)}’s branch
                          {!g.active && ' (waiting for 2FA)'}
                        </div>
                      ))}
                      {grants.length === 0 && !card && '—'}
                      {card && <div className="row-meta">Card: {card}</div>}
                    </div>
                  </td>
                  <td data-label={COLUMNS[3]}>
                    <div className="cell">{new Date(m.joinedAt).toLocaleDateString()}</div>
                  </td>
                  <td data-label={COLUMNS[4]}>
                    {(canManage(m) || more.length > 0) && (
                      <div className="row-actions cell">
                        {canManage(m) && (
                          <ConfirmButton
                            label="Remove"
                            confirmLabel="Remove from tree"
                            danger
                            compact
                            onConfirm={() =>
                              void act(
                                () => api.removeMember(treeId, m.userId),
                                ['members', 'stewards', 'invites'],
                              )
                            }
                          />
                        )}
                        {more.length > 0 && (
                          <MenuButton label={`More actions for ${m.name}`} items={more} />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {members.length === 1 && (
        <EmptyState
          icon={<UsersIcon />}
          title="It’s just you so far"
          body={
            detail.capabilities.invite
              ? 'Invite relatives below so they can see the tree or help fill it in.'
              : 'Other members of this tree will show up here.'
          }
        />
      )}
      {link && (
        <CopyLink label="Reset link" url={link.url}>
          Send this link to {link.name} yourself. It works once, for 24 hours.
        </CopyLink>
      )}
      <ConfirmDialog
        open={linkTarget !== null}
        title={`Which person is ${linkTarget?.name ?? 'this member'}?`}
        confirmLabel="Link"
        confirmDisabled={!linking?.personId}
        onCancel={() => setLinking(null)}
        onConfirm={() => {
          const l = linking;
          setLinking(null);
          if (l?.personId)
            void act(() => api.setMemberPerson(treeId, l.userId, l.personId), ['members']);
        }}
      >
        <p>Their card shows them as “You”, and the tree opens on it for them.</p>
        <div className="field">
          <label htmlFor={linkSelectId}>Person</label>
          <select
            id={linkSelectId}
            value={linking?.personId ?? ''}
            onChange={(e) => setLinking((l) => (l ? { ...l, personId: e.target.value } : l))}
          >
            <option value="">Choose…</option>
            {linkOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={unlinkTarget !== null}
        title={`Unlink ${unlinkTarget?.name ?? 'them'} from ${personLabel(unlinkTarget?.personId ?? null)}?`}
        confirmLabel="Unlink"
        danger
        onCancel={() => setUnlinking(null)}
        onConfirm={() => {
          const u = unlinking;
          setUnlinking(null);
          if (u) void act(() => api.setMemberPerson(treeId, u, null), ['members']);
        }}
      >
        <p>The card stays in the tree. They can choose “This is me” again, or you can link them.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={transferTarget !== null}
        title={`Make ${transferTarget?.name ?? 'them'} the owner?`}
        confirmLabel="Transfer ownership"
        onCancel={() => setTransferTo(null)}
        onConfirm={() => {
          const to = transferTo;
          setTransferTo(null);
          if (to)
            void act(
              () => api.transferOwnership(treeId, to),
              ['tree', 'members', 'stewards', 'invites'],
            );
        }}
      >
        <p>You become an editor of this tree, and the invite links you made stop working.</p>
      </ConfirmDialog>
    </section>
  );
}
