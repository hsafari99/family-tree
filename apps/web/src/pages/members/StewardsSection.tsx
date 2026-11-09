import type { StewardGrant } from '@family-tree/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { actionMessage, type SectionProps } from './types';

export function StewardsSection({
  treeId,
  detail,
  persons,
  members,
  me,
  reload,
  stewards,
}: SectionProps & { stewards: StewardGrant[] }) {
  const api = useTreesApi();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [personId, setPersonId] = useState('');
  const isOwner = detail.me.role === 'owner';
  const candidates = members.filter((m) => m.role !== 'owner' && m.userId !== me);
  const nameOfPerson = (id: string) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'someone';
  };

  useEffect(() => {
    if (userId === '' && candidates[0]) setUserId(candidates[0].userId);
    if (personId === '' && persons[0]) setPersonId(persons[0].id);
  }, [candidates, persons, userId, personId]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await api.grantSteward(treeId, { userId, anchorPersonId: personId });
    if (!res.ok) {
      setError(
        res.error.code === 'FORBIDDEN'
          ? 'You can only grant stewardship inside your own branch'
          : actionMessage(res.error),
      );
      return;
    }
    await reload('stewards');
  }

  async function revoke(id: string) {
    setError(null);
    const res = await api.revokeSteward(treeId, id);
    if (!res.ok) return setError(actionMessage(res.error));
    await reload('stewards');
  }

  return (
    <section>
      <h2>Branch stewards</h2>
      <p>
        A steward can add, edit and delete people in one branch of the family, and invite relatives
        to it.
      </p>
      <FormError>{error}</FormError>
      {stewards.length === 0 ? (
        <p>No branch stewards yet.</p>
      ) : (
        <ul>
          {stewards.map((s) => (
            <li key={s.id}>
              {s.userName} looks after {nameOfPerson(s.anchorPersonId)}&apos;s branch, granted by{' '}
              {s.grantedByName ?? 'someone who left'}
              {!s.active && ' (starts when they turn on two-step verification)'}{' '}
              {(isOwner || (detail.me.steward.active && s.grantedByUserId === me)) && (
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Revoke stewardship"
                  danger
                  onConfirm={() => void revoke(s.id)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.capabilities.grantStewardship && (
        <form onSubmit={grant}>
          <h3>Make someone a steward</h3>
          <div className="field">
            <label htmlFor="steward-member">Member</label>
            <select id="steward-member" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="steward-person">Branch of</label>
            <select
              id="steward-person"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={userId === '' || personId === ''}>
            Make steward
          </button>
        </form>
      )}
    </section>
  );
}
