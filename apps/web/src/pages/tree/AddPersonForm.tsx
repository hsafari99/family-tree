import {
  type CreatePersonInput,
  createPersonSchema,
  type PersonSummary,
  RELATIVE_ROLES,
  type TreeDetail,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { canvasSearch } from '../../canvas/params';
import { useToast } from '../../components/Toast';
import { ErrorSummary, FormError, validateDeep, type FieldErrors } from '../../components/forms';
import { personName } from '../../trees/format';
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
} from './QuickPersonFields';

const NO_EXCLUDED: readonly string[] = [];
/** The new person is `as` of the chosen one: "Parent of Ann Hale" sends as: 'parent' (brief #10). */
const ROLE_LABEL = {
  parent: 'Parent of',
  child: 'Child of',
  partner: 'Partner or spouse of',
  sibling: 'Sibling of',
};

const ADD_PERSON_LABELS: Record<string, string> = { ...QUICK_LABELS, connect: 'Related to' };

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
  const [params] = useSearchParams();
  const toast = useToast();
  // Opening someone closes the dialog (no `tab`) and keeps the canvas's view.
  const open = (id: string) =>
    void navigate(
      `/trees/${treeId}/people/${id}${canvasSearch(params, { tab: null, add: null, focus: null, from: null, to: null })}`,
    );
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
  const [unionType, setUnionType] = useState('marriage');
  const [unionStatus, setUnionStatus] = useState('married');
  const chosen = persons.find((p) => p.id === to);
  const link = {
    as,
    kind: 'biological',
    ...(as === 'partner' ? { union: { type: unionType, status: unionStatus } } : {}),
  };
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
      ...(to ? { attach: { to, ...link } } : {}),
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
    const { givenName, middleName = null, surname = null } = input.person;
    toast.show(`${personName({ givenName, middleName, surname })} added`);
    open(res.data.id);
  }

  async function linkExisting(p: PersonSummary) {
    setError(null);
    if (to) {
      setPending(true);
      const res = await api.addRelative(treeId, to, {
        personId: p.id,
        ...link,
      } as Parameters<typeof api.addRelative>[2]);
      if (!alive.current) return;
      setPending(false);
      if (!res.ok) return setError(res.error.message);
      onCreated();
      toast.show(`${personName(p)} connected`);
    }
    open(p.id);
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
      <p className="hint">You can add more details after saving.</p>
      <FormError>{error}</FormError>
      <ErrorSummary errors={errors} labels={ADD_PERSON_LABELS} />
      <QuickPersonFields
        values={quick}
        onChange={(v) => {
          dup.dismiss();
          setQuick(v);
        }}
        errors={errors}
      />
      <div className="field">
        <label htmlFor={`${uid}-connect`}>Related to</label>
        {mustConnect && !errors.connect && (
          <p className="hint">Choose someone in your branch to connect them to.</p>
        )}
        <select
          id={`${uid}-connect`}
          data-field="connect"
          aria-describedby={errors.connect ? `${uid}-connect-error` : undefined}
          value={to}
          onChange={(e) => setTo(e.target.value)}
        >
          <option value="">{mustConnect ? 'Choose…' : 'No one'}</option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {personName(p)}
            </option>
          ))}
        </select>
        {errors.connect && (
          <p id={`${uid}-connect-error`} className="field-error">
            {errors.connect}
          </p>
        )}
      </div>
      <SelectField
        label="Relationship"
        value={as}
        onChange={setAs}
        disabled={!to}
        options={RELATIVE_ROLES.map((r) => ({
          value: r,
          label: `${ROLE_LABEL[r]} ${chosen ? personName(chosen) : '…'}`,
        }))}
      />
      {to && as === 'partner' && (
        <UnionChoiceSelects
          type={unionType}
          status={unionStatus}
          onType={setUnionType}
          onStatus={setUnionStatus}
        />
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
