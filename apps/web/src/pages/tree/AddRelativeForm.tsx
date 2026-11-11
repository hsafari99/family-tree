import {
  CHILD_KINDS,
  type CreatePersonInput,
  createPersonSchema,
  type PersonSummary,
  type PersonView,
  type RelativeRole,
  UNION_STATUSES,
  UNION_TYPES,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FormError, validateDeep, type FieldErrors } from '../../components/forms';
import {
  CHILD_KIND_LABEL,
  personName,
  UNION_STATUS_LABEL,
  UNION_TYPE_LABEL,
} from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { DuplicatePrompt } from './DuplicatePrompt';
import { similarQueryOf, useDuplicateCheck } from './useDuplicateCheck';
import { emptyQuick, QuickPersonFields, quickErrors, quickPerson } from './QuickPersonFields';

const names = (people: PersonSummary[], fallback: string) =>
  people.length > 0 ? people.map(personName).join(' and ') : fallback;

/** Everyone already in this role, so the "existing person" list leaves them out. */
function alreadyIn(subject: PersonView, as: RelativeRole): string[] {
  const r = subject.relations;
  switch (as) {
    case 'parent':
      return r.parents.flatMap((p) => p.parents.map((x) => x.id));
    case 'child':
      return r.unions.flatMap((u) => u.children.map((c) => c.person.id));
    case 'partner':
      return r.unions.flatMap((u) => (u.partner ? [u.partner.id] : []));
    case 'sibling':
      return r.siblings.map((s) => s.person.id);
  }
}

export function AddRelativeForm({
  treeId,
  subject,
  as,
  persons,
  onDone,
  onCancel,
}: {
  treeId: string;
  subject: PersonView;
  as: RelativeRole;
  persons: PersonSummary[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const api = useTreesApi();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const rel = subject.relations;
  const withPartner = rel.unions.filter((u) => u.partner);
  const joinable = rel.parents.filter((p) => p.parents.length < 2);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [quick, setQuick] = useState(
    emptyQuick(as === 'child' || as === 'sibling' ? (subject.person.surname ?? '') : ''),
  );
  const [existingId, setExistingId] = useState('');
  const [childUnion, setChildUnion] = useState(withPartner.length === 1 ? withPartner[0]!.id : '');
  const [parentUnion, setParentUnion] = useState(joinable[0]?.union.id ?? '');
  const [siblingUnion, setSiblingUnion] = useState(rel.parents[0]?.union.id ?? '');
  const [kind, setKind] = useState('biological');
  const [unionType, setUnionType] = useState('marriage');
  const [unionStatus, setUnionStatus] = useState('married');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dup = useDuplicateCheck(
    treeId,
    useMemo(() => [subject.person.id], [subject.person.id]),
  );

  const unionId =
    as === 'child'
      ? childUnion
      : as === 'parent'
        ? parentUnion
        : as === 'sibling' && rel.parents.length > 1
          ? siblingUnion
          : '';
  const link = {
    as,
    kind,
    ...(unionId ? { unionId } : {}),
    ...(as === 'partner' ? { union: { type: unionType, status: unionStatus } } : {}),
  };
  const taken = new Set([subject.person.id, ...alreadyIn(subject, as)]);
  const candidates = persons.filter((p) => !taken.has(p.id));

  /** The create request for the typed person, or null (errors are shown) when it's invalid. */
  function newInput(): CreatePersonInput | null {
    const incomplete = quickErrors(quick);
    if (Object.keys(incomplete).length > 0) {
      setErrors(incomplete);
      return null;
    }
    const input = { person: quickPerson(quick), attach: { to: subject.person.id, ...link } };
    const v = validateDeep(createPersonSchema, input);
    if (!v.ok) {
      setErrors(v.errors);
      return null;
    }
    setErrors({});
    return input as CreatePersonInput;
  }

  async function finish(res: { ok: true } | { ok: false; error: { message: string } }) {
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  }

  async function createNew(input: CreatePersonInput) {
    setError(null);
    setPending(true);
    await finish(await api.createPerson(treeId, input));
  }

  async function linkExisting(personId: string) {
    setError(null);
    setPending(true);
    await finish(
      await api.addRelative(treeId, subject.person.id, {
        personId,
        ...link,
      } as Parameters<typeof api.addRelative>[2]),
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'existing') {
      if (!existingId) return setErrors({ existing: 'Choose a person' });
      return linkExisting(existingId);
    }
    const input = newInput();
    if (!input) return;
    setPending(true);
    const fine = await dup.check(similarQueryOf(quick));
    if (!alive.current) return;
    if (!fine) return setPending(false); // the prompt is showing
    await createNew(input);
  }

  const select = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} aria-label={`Add ${as}`}>
      <FormError>{error}</FormError>
      <fieldset>
        <legend>Add a {as}</legend>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />{' '}
          A new person
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
          />{' '}
          Someone already in the tree
        </label>
      </fieldset>
      {mode === 'new' ? (
        <QuickPersonFields
          values={quick}
          onChange={(v) => {
            dup.dismiss();
            setQuick(v);
          }}
          errors={errors}
        />
      ) : (
        <div className="field">
          <label htmlFor={`${uid}-existing`}>Person</label>
          <select
            id={`${uid}-existing`}
            value={existingId}
            onChange={(e) => setExistingId(e.target.value)}
          >
            <option value="">Choose…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
          {errors.existing && <p className="field-error">{errors.existing}</p>}
        </div>
      )}
      {as === 'child' &&
        select(`${uid}-other-parent`, 'Other parent', childUnion, setChildUnion, [
          ...rel.unions.map((u) => ({
            value: u.id,
            label: u.partner ? `with ${personName(u.partner)}` : 'with an unknown partner',
          })),
          { value: '', label: 'Unknown other parent' },
        ])}
      {as === 'parent' &&
        joinable.length > 0 &&
        select(`${uid}-join`, 'Which parents', parentUnion, setParentUnion, [
          ...joinable.map((p) => ({
            value: p.union.id,
            label: `Join ${names(p.parents, 'an unknown parent')}`,
          })),
          { value: '', label: 'Start a new pair of parents' },
        ])}
      {as === 'sibling' &&
        rel.parents.length > 1 &&
        select(
          `${uid}-shared`,
          'Shared parents',
          siblingUnion,
          setSiblingUnion,
          rel.parents.map((p) => ({
            value: p.union.id,
            label: names(p.parents, 'Unknown parents'),
          })),
        )}
      {as !== 'partner' &&
        select(
          `${uid}-kind`,
          'Kind',
          kind,
          setKind,
          CHILD_KINDS.map((k) => ({ value: k, label: CHILD_KIND_LABEL[k] })),
        )}
      {as === 'partner' && (
        <>
          {select(
            `${uid}-type`,
            'Type',
            unionType,
            setUnionType,
            UNION_TYPES.map((k) => ({ value: k, label: UNION_TYPE_LABEL[k] })),
          )}
          {select(
            `${uid}-status`,
            'Status',
            unionStatus,
            setUnionStatus,
            UNION_STATUSES.map((k) => ({ value: k, label: UNION_STATUS_LABEL[k] })),
          )}
        </>
      )}
      {mode === 'new' && dup.matches && (
        <DuplicatePrompt
          matches={dup.matches}
          pending={pending}
          onUse={(p) => void linkExisting(p.id)}
          onCreateNew={() => {
            const input = newInput();
            if (!input) return;
            dup.confirmNew(similarQueryOf(quick));
            void createNew(input);
          }}
        />
      )}
      <p className="actions">
        <button type="submit" disabled={pending}>
          Add
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
