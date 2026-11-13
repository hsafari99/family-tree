import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PlusIcon } from '../../components/icons';
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
  onActed,
}: SectionProps) {
  const api = useTreesApi();
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [personId, setPersonId] = useState('');
  const [pending, setPending] = useState(false);
  // The grant form opens on request and closes once granted or on Cancel, focus back on its button.
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const memberSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (adding) memberSelect.current?.focus();
  }, [adding]);
  const closeForm = () => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const candidates = useMemo(
    () => members.filter((m) => m.role !== 'owner' && m.userId !== me),
    [members, me],
  );

  useEffect(() => {
    // Keep the selections pointing at someone who is still in the list.
    if (!candidates.some((c) => c.userId === userId)) setUserId(candidates[0]?.userId ?? '');
    if (!persons.some((p) => p.id === personId)) setPersonId(persons[0]?.id ?? '');
  }, [candidates, persons, userId, personId]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    // The selects show the first option until the effect below syncs state; submit what is shown.
    const grantee = candidates.some((c) => c.userId === userId) ? userId : candidates[0]?.userId;
    const anchor = persons.some((p) => p.id === personId) ? personId : persons[0]?.id;
    if (pending || !grantee || !anchor) return;
    setError(null);
    setPending(true);
    const res = await api.grantSteward(treeId, { userId: grantee, anchorPersonId: anchor });
    setPending(false);
    if (!res.ok) {
      setError(
        res.error.code === 'FORBIDDEN'
          ? 'You can only grant stewardship inside your own branch'
          : actionMessage(res.error),
      );
      return;
    }
    closeForm();
    onActed(null);
    await reload('stewards');
  }

  if (!detail.capabilities.grantStewardship) return null;
  return (
    <section>
      <h2>Branch stewards</h2>
      <p>
        A steward can add, edit and delete people in one branch of the family, and invite relatives
        to it.
      </p>
      {/* Who is a steward of what shows in the members table above, with Revoke in each
          member's More actions; this section only explains it and grants new ones. */}
      <FormError>{error}</FormError>
      {candidates.length === 0 && (
        <p className="hint">
          Invite someone and have them join first; then you can make them a steward.
        </p>
      )}
      {candidates.length > 0 && !adding && (
        <p>
          <button type="button" ref={addButton} onClick={() => setAdding(true)}>
            <PlusIcon /> Make someone a steward
          </button>
        </p>
      )}
      {candidates.length > 0 && adding && (
        <form onSubmit={grant}>
          <h3>Make someone a steward</h3>
          <div className="field">
            <label htmlFor="steward-member">Member</label>
            <select
              id="steward-member"
              ref={memberSelect}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
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
          <p className="form-actions">
            <button type="submit" disabled={pending || userId === '' || personId === ''}>
              Make steward
            </button>
            <button type="button" className="secondary" onClick={closeForm}>
              Cancel
            </button>
          </p>
        </form>
      )}
    </section>
  );
}
