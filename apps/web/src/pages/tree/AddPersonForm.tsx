import {
  type CreatePersonInput,
  createPersonSchema,
  type PersonSummary,
  RELATIVE_ROLES,
  type TreeDetail,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FormError, validateDeep, type FieldErrors } from '../../components/forms';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { DuplicatePrompt } from './DuplicatePrompt';
import { similarQueryOf, useDuplicateCheck } from './useDuplicateCheck';
import { emptyQuick, QuickPersonFields, quickErrors, quickPerson } from './QuickPersonFields';

const NO_EXCLUDED: readonly string[] = [];
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
  const uid = useId();
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
  const dup = useDuplicateCheck(treeId, NO_EXCLUDED);
  const mustConnect = !detail.capabilities.editAnywhere;

  /** The create request for the typed person, or null (errors are shown) when it's invalid. */
  function newInput(): CreatePersonInput | null {
    if (mustConnect && !to) {
      setErrors({ connect: 'Choose someone in your branch to connect them to.' });
      return null;
    }
    const incomplete = quickErrors(quick);
    if (Object.keys(incomplete).length > 0) {
      setErrors(incomplete);
      return null;
    }
    const input = {
      person: quickPerson(quick),
      ...(to ? { attach: { to, as, kind: 'biological' } } : {}),
    };
    const v = validateDeep(createPersonSchema, input);
    if (!v.ok) {
      setErrors(v.errors);
      return null;
    }
    setErrors({});
    return input as CreatePersonInput;
  }

  async function createNew(input: CreatePersonInput) {
    setError(null);
    setPending(true);
    const res = await api.createPerson(treeId, input);
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onCreated();
    void navigate(`/trees/${treeId}/people/${res.data.id}`);
  }

  async function linkExisting(p: PersonSummary) {
    setError(null);
    if (to) {
      setPending(true);
      const res = await api.addRelative(treeId, to, {
        personId: p.id,
        as,
        kind: 'biological',
      } as Parameters<typeof api.addRelative>[2]);
      if (!alive.current) return;
      setPending(false);
      if (!res.ok) return setError(res.error.message);
      onCreated();
    }
    void navigate(`/trees/${treeId}/people/${p.id}`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input = newInput();
    if (!input) return;
    setPending(true);
    const fine = await dup.check(similarQueryOf(quick));
    if (!alive.current) return;
    if (!fine) return setPending(false); // the prompt is showing
    await createNew(input);
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2>Add a person</h2>
      <p className="hint">You can add more details after saving.</p>
      <FormError>{error}</FormError>
      <QuickPersonFields
        values={quick}
        onChange={(v) => {
          dup.dismiss();
          setQuick(v);
        }}
        errors={errors}
      />
      <div className="field">
        <label htmlFor={`${uid}-connect`}>Connect to</label>
        {mustConnect && !errors.connect && (
          <p className="hint">Choose someone in your branch to connect them to.</p>
        )}
        <select id={`${uid}-connect`} value={to} onChange={(e) => setTo(e.target.value)}>
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
          <label htmlFor={`${uid}-as`}>as their</label>
          <select id={`${uid}-as`} value={as} onChange={(e) => setAs(e.target.value)}>
            {RELATIVE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      )}
      {dup.matches && (
        <DuplicatePrompt
          matches={dup.matches}
          pending={pending}
          onUse={(p) => void linkExisting(p)}
          onCreateNew={() => {
            const input = newInput();
            if (!input) return;
            dup.confirmNew(similarQueryOf(quick));
            void createNew(input);
          }}
        />
      )}
      <button type="submit" disabled={pending}>
        Add person
      </button>
    </form>
  );
}
