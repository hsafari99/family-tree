import {
  CHILD_KINDS,
  type CreatePersonInput,
  createPersonSchema,
  type PersonSummary,
  type PersonView,
  type RelativeRole,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ErrorSummary, FormError, validateDeep, type FieldErrors } from '../../components/forms';
import { CHILD_KIND_LABEL, personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { DuplicatePrompt } from './DuplicatePrompt';
import { SelectField, UnionChoiceSelects } from './RelationSelects';
import { similarQueryOf, useDuplicateCheck } from './useDuplicateCheck';
import {
  emptyQuick,
  QUICK_LABELS,
  QuickPersonFields,
  quickErrors,
  quickPerson,
  type QuickValues,
} from './QuickPersonFields';

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

const SECOND = 'coParent.person';
const ADD_RELATIVE_LABELS: Record<string, string> = {
  ...QUICK_LABELS,
  existing: 'Person',
  [`${SECOND}.givenName`]: 'Second parent’s first name',
  [`${SECOND}.surname`]: 'Second parent’s last name',
  [`${SECOND}.sex`]: 'Second parent’s sex',
  [`${SECOND}.birthDate`]: 'Second parent born',
  'coParent.existing': 'Second parent',
  coParent: 'Second parent',
};

/** Errors for one new person, keyed under `prefix` (`person` or `coParent.person`), or null. */
function personErrors(v: QuickValues, prefix: string): FieldErrors | null {
  const incomplete = quickErrors(v, prefix);
  if (Object.keys(incomplete).length > 0) return incomplete;
  const r = validateDeep(createPersonSchema, { person: quickPerson(v) });
  if (r.ok) return null;
  return Object.fromEntries(
    Object.entries(r.errors).map(([k, m]) => [k.replace(/^person/, prefix), m]),
  );
}

interface Choice {
  mode: 'new' | 'existing';
  quick: QuickValues;
  existingId: string;
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
  // Parent unions with a free slot: one known parent, or a parents-unknown union (brief #9, #11).
  const joinable = rel.parents.filter((p) => p.parents.length < 2);
  // "Is the other parent already in the tree?": re-link to a couple instead (brief #9, #13).
  const relinks =
    as === 'parent' ? rel.parents.filter((p) => p.parents.length === 1 && p.moveTo.length > 0) : [];

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
  const [withSecond, setWithSecond] = useState(false);
  const [second, setSecond] = useState<Choice>({
    mode: 'new',
    quick: emptyQuick(),
    existingId: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const exclude = useMemo(() => [subject.person.id], [subject.person.id]);
  const dup = useDuplicateCheck(treeId, exclude);
  const dup2 = useDuplicateCheck(treeId, exclude);

  const canPair = as === 'parent' && joinable.length === 0;
  const pairing = canPair && withSecond;

  // parent: '' is "start a new pair of parents", sent as null (brief #9).
  const unionId: string | null | undefined =
    as === 'child'
      ? childUnion || undefined
      : as === 'parent'
        ? joinable.length > 0
          ? parentUnion || null
          : undefined
        : as === 'sibling' && rel.parents.length > 1
          ? siblingUnion || undefined
          : undefined;
  const link = {
    as,
    kind,
    ...(unionId !== undefined ? { unionId } : {}),
    ...(as === 'partner' ? { union: { type: unionType, status: unionStatus } } : {}),
  };
  const attach = { to: subject.person.id, ...link };
  const taken = new Set([subject.person.id, ...alreadyIn(subject, as)]);
  const candidates = persons.filter((p) => !taken.has(p.id));

  async function finish(res: { ok: true } | { ok: false; error: { message: string } }) {
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  }

  async function create(input: CreatePersonInput) {
    const v = validateDeep(createPersonSchema, input);
    if (!v.ok) {
      setPending(false);
      return setErrors(v.errors);
    }
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

  async function relink(linkId: string, toUnion: string) {
    setError(null);
    setPending(true);
    await finish(await api.reparentLink(treeId, linkId, toUnion));
  }

  /**
   * Validates and sends. `firstId`/`secondId` override a slot with an existing person (the
   * duplicate prompt's "Yes, use them", before its state update has landed).
   */
  async function go(o: { firstId?: string; secondId?: string } = {}) {
    setError(null);
    const first = o.firstId ?? (mode === 'existing' ? existingId : undefined);
    const other = pairing
      ? (o.secondId ?? (second.mode === 'existing' ? second.existingId : undefined))
      : undefined;
    const errs: FieldErrors = {};
    if (first === '') errs.existing = 'Choose a person';
    if (pairing && other === '') errs['coParent.existing'] = 'Choose a person';
    if (first === undefined) Object.assign(errs, personErrors(quick, 'person') ?? {});
    if (pairing && other === undefined)
      Object.assign(errs, personErrors(second.quick, SECOND) ?? {});
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setPending(true);
    // The duplicate check runs for each new person in turn.
    if (first === undefined && !(await dup.check(similarQueryOf(quick)))) return setPending(false);
    if (!alive.current) return;
    if (pairing && other === undefined && !(await dup2.check(similarQueryOf(second.quick)))) {
      return setPending(false);
    }
    if (!alive.current) return;

    if (!pairing) {
      if (first !== undefined) return linkExisting(first);
      return create({ person: quickPerson(quick), attach } as CreatePersonInput);
    }
    if (first === undefined) {
      return create({
        person: quickPerson(quick),
        attach,
        coParent: other === undefined ? { person: quickPerson(second.quick) } : { personId: other },
      } as CreatePersonInput);
    }
    if (other === undefined) {
      // The first parent exists: the new second parent is the created one, joined by the first.
      return create({
        person: quickPerson(second.quick),
        attach,
        coParent: { personId: first },
      } as CreatePersonInput);
    }
    // Both exist: the first opens a new pair, which the second then joins (the only open one).
    const one = await api.addRelative(treeId, subject.person.id, {
      personId: first,
      ...link,
    } as Parameters<typeof api.addRelative>[2]);
    if (!one.ok) return finish(one);
    await finish(
      await api.addRelative(treeId, subject.person.id, {
        personId: other,
        as: 'parent',
        kind,
      } as Parameters<typeof api.addRelative>[2]),
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void go();
  }

  const parentOptions = () => {
    const singles = joinable.filter((p) => p.parents.length === 1);
    const separate =
      joinable.length === 1 && singles.length === 1
        ? `Not ${personName(singles[0]!.parents[0]!)}’s partner (a separate parent)`
        : singles.length === 0
          ? 'Only their parent'
          : 'A separate parent';
    return [
      ...joinable.map((p) => ({
        value: p.union.id,
        label:
          p.parents.length === 1
            ? `Partner of ${personName(p.parents[0]!)} (parents together)`
            : 'Parent of them and their siblings',
      })),
      { value: '', label: separate },
    ];
  };

  return (
    <form onSubmit={submit} aria-label={`Add ${as}`}>
      <FormError>{error}</FormError>
      <ErrorSummary errors={errors} labels={ADD_RELATIVE_LABELS} />
      {relinks.length > 0 && (
        <section className="relink" role="group" aria-labelledby={`${uid}-relink`}>
          <h3 id={`${uid}-relink`}>Is the other parent already in the tree?</h3>
          <p className="actions">
            {relinks.flatMap((p) =>
              p.moveTo.map((m) => (
                <button
                  key={`${p.linkId}:${m.unionId}`}
                  type="button"
                  className="secondary"
                  disabled={pending}
                  onClick={() => void relink(p.linkId, m.unionId)}
                >
                  Add as child of {names(m.parents, 'unknown parents')}
                </button>
              )),
            )}
          </p>
        </section>
      )}
      <fieldset>
        <legend>Add a {as}</legend>
        <label>
          <input
            type="radio"
            name={`${uid}-mode`}
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />{' '}
          A new person
        </label>
        <label>
          <input
            type="radio"
            name={`${uid}-mode`}
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
        <ExistingSelect
          id={`${uid}-existing`}
          name="existing"
          value={existingId}
          onChange={setExistingId}
          candidates={candidates}
          error={errors.existing}
        />
      )}
      {mode === 'new' && dup.matches && (
        <DuplicatePrompt
          matches={dup.matches}
          pending={pending}
          onUse={(p) => {
            if (!pairing) return void linkExisting(p.id);
            dup.dismiss();
            setMode('existing');
            setExistingId(p.id);
            void go({ firstId: p.id });
          }}
          onCreateNew={() => {
            dup.confirmNew(similarQueryOf(quick));
            void go();
          }}
        />
      )}
      {as === 'child' && (
        <SelectField
          label="Other parent"
          value={childUnion}
          onChange={setChildUnion}
          options={[
            ...rel.unions.map((u) => ({
              value: u.id,
              label: u.partner ? `with ${personName(u.partner)}` : 'with an unknown partner',
            })),
            { value: '', label: 'Unknown other parent' },
          ]}
        />
      )}
      {as === 'parent' && joinable.length > 0 && (
        <SelectField
          label="Which parents"
          value={parentUnion}
          onChange={setParentUnion}
          options={parentOptions()}
        />
      )}
      {as === 'sibling' && rel.parents.length > 1 && (
        <SelectField
          label="Shared parents"
          value={siblingUnion}
          onChange={setSiblingUnion}
          options={rel.parents.map((p) => ({
            value: p.union.id,
            label: names(p.parents, 'Unknown parents'),
          }))}
        />
      )}
      {as !== 'partner' && (
        <SelectField
          label="Kind"
          value={kind}
          onChange={setKind}
          options={CHILD_KINDS.map((k) => ({ value: k, label: CHILD_KIND_LABEL[k] }))}
        />
      )}
      {as === 'partner' && (
        <UnionChoiceSelects
          type={unionType}
          status={unionStatus}
          onType={setUnionType}
          onStatus={setUnionStatus}
        />
      )}
      {canPair && (
        <div className="field field-check">
          <label>
            <input
              type="checkbox"
              checked={withSecond}
              onChange={(e) => setWithSecond(e.target.checked)}
            />{' '}
            Add a second parent too
          </label>
        </div>
      )}
      {pairing && (
        <fieldset className="second-parent">
          <legend>Second parent</legend>
          <label>
            <input
              type="radio"
              name={`${uid}-second-mode`}
              checked={second.mode === 'new'}
              onChange={() => setSecond({ ...second, mode: 'new' })}
            />{' '}
            A new person
          </label>
          <label>
            <input
              type="radio"
              name={`${uid}-second-mode`}
              checked={second.mode === 'existing'}
              onChange={() => setSecond({ ...second, mode: 'existing' })}
            />{' '}
            Someone already in the tree
          </label>
          {second.mode === 'new' ? (
            <QuickPersonFields
              prefix={SECOND}
              values={second.quick}
              onChange={(v) => {
                dup2.dismiss();
                setSecond({ ...second, quick: v });
              }}
              errors={errors}
            />
          ) : (
            <ExistingSelect
              id={`${uid}-second-existing`}
              name="coParent.existing"
              value={second.existingId}
              onChange={(v) => setSecond({ ...second, existingId: v })}
              candidates={candidates.filter((p) => p.id !== existingId)}
              error={errors['coParent.existing']}
            />
          )}
          {second.mode === 'new' && dup2.matches && (
            <DuplicatePrompt
              matches={dup2.matches}
              pending={pending}
              onUse={(p) => {
                dup2.dismiss();
                setSecond({ ...second, mode: 'existing', existingId: p.id });
                void go({ secondId: p.id });
              }}
              onCreateNew={() => {
                dup2.confirmNew(similarQueryOf(second.quick));
                void go();
              }}
            />
          )}
        </fieldset>
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

function ExistingSelect({
  id,
  name,
  value,
  onChange,
  candidates,
  error,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  candidates: PersonSummary[];
  error: string | undefined;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Person</label>
      <select
        id={id}
        data-field={name}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {personName(p)}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
