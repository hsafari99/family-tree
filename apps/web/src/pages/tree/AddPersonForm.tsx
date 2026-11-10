import {
  type CreatePersonInput,
  createPersonSchema,
  type PersonSummary,
  RELATIVE_ROLES,
  type TreeDetail,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError, validateDeep, type FieldErrors } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { emptyQuick, QuickPersonFields, quickPerson } from './QuickPersonFields';

const ROLE_LABEL = { parent: 'Parent', child: 'Child', partner: 'Partner', sibling: 'Sibling' };

export function AddPersonForm({
  treeId,
  persons,
  detail,
  onCreated,
}: {
  treeId: string;
  persons: PersonSummary[];
  detail: TreeDetail;
  onCreated: () => void;
}) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [quick, setQuick] = useState(emptyQuick());
  const [to, setTo] = useState('');
  const [as, setAs] = useState('child');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mustConnect = !detail.capabilities.editAnywhere;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mustConnect && !to) {
      return setErrors({ connect: 'Choose someone in your branch to connect them to.' });
    }
    const input = {
      person: quickPerson(quick),
      ...(to ? { attach: { to, as, kind: 'biological' } } : {}),
    };
    const v = validateDeep(createPersonSchema, input);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setPending(true);
    const res = await api.createPerson(treeId, input as CreatePersonInput);
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onCreated();
    void navigate(`/trees/${treeId}/people/${res.data.id}`);
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2>Add a person</h2>
      <p className="hint">You can add more details after saving.</p>
      <FormError>{error}</FormError>
      <QuickPersonFields values={quick} onChange={setQuick} errors={errors} />
      <div className="field">
        <label htmlFor="add-connect">Connect to</label>
        {mustConnect && !errors.connect && (
          <p className="hint">Choose someone in your branch to connect them to.</p>
        )}
        <select id="add-connect" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">{mustConnect ? 'Choose…' : 'No one'}</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {personName(p)}
            </option>
          ))}
        </select>
        {errors.connect && <p className="field-error">{errors.connect}</p>}
      </div>
      {to && (
        <div className="field">
          <label htmlFor="add-as">as their</label>
          <select id="add-as" value={as} onChange={(e) => setAs(e.target.value)}>
            {RELATIVE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" disabled={pending}>
        Add person
      </button>
    </form>
  );
}
