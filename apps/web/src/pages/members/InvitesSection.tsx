import type { CreatedInvite, Invite } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { describeInvite, InviteForm, InviteLink, mayRevoke } from './InviteForm';
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
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  // A new form after each invite: the choices made for the last one were used, not a draft (so an
  // outside click can close the dialog), and the next invite starts from the defaults.
  const [formKey, setFormKey] = useState(0);
  // Skip the mount run: under load it can fire after a click has already set `created`.
  const seenActed = useRef(acted.n);
  useEffect(() => {
    if (acted.n === seenActed.current) return;
    seenActed.current = acted.n;
    if (acted.from !== 'invite') setCreated(null);
  }, [acted]);
  const linked = new Set(members.map((m) => m.personId).filter(Boolean));
  const unlinked = persons.filter((p) => !linked.has(p.id));
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'someone';
  };

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
      <InviteForm
        key={formKey}
        treeId={treeId}
        detail={detail}
        persons={persons}
        candidates={unlinked}
        onCreated={(c) => {
          setCreated(c);
          setFormKey((k) => k + 1);
          onActed('invite');
          void reload('invites');
        }}
      />
      {created && <InviteLink created={created} />}
      <h3>Open invites</h3>
      {invites.length === 0 ? (
        <p>No open invites.</p>
      ) : (
        <ul>
          {invites.map((i) => (
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
      )}
    </section>
  );
}
