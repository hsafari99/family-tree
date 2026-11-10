import {
  CHILD_KINDS,
  type ChildKind,
  type PersonSummary,
  type PersonView,
  type RelativeRole,
  UNION_STATUSES,
  UNION_TYPES,
  updateUnionSchema,
} from '@family-tree/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmButton } from '../../components/ConfirmButton';
import {
  FuzzyDateField,
  fromDraft,
  toDraft,
  type FuzzyDraft,
} from '../../components/FuzzyDateField';
import { FormError, Success, validate, type FieldErrors } from '../../components/forms';
import {
  CHILD_KIND_LABEL,
  formatFuzzyDate,
  personName,
  UNION_STATUS_LABEL,
  UNION_TYPE_LABEL,
} from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { AddRelativeForm } from './AddRelativeForm';
import type { TabProps } from './usePersonSave';

type Union = PersonView['relations']['unions'][number];

const ROLES: { as: RelativeRole; label: string }[] = [
  { as: 'parent', label: 'Add parent' },
  { as: 'partner', label: 'Add partner' },
  { as: 'child', label: 'Add child' },
  { as: 'sibling', label: 'Add sibling' },
];

export function RelationsTab({
  treeId,
  view,
  reload,
  onChanged,
  persons,
}: TabProps & { persons: PersonSummary[] }) {
  const api = useTreesApi();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [adding, setAdding] = useState<RelativeRole | null>(null);
  const [editingUnion, setEditingUnion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { relations: rel, capabilities: caps } = view;
  const person = (p: PersonSummary) => (
    <Link to={`/trees/${treeId}/people/${p.id}`}>{personName(p)}</Link>
  );

  async function after(res: { ok: boolean; error?: { message: string } }, message?: string) {
    if (!alive.current) return;
    if (!res.ok) return setError(res.error?.message ?? null);
    setError(null);
    setNotice(message ?? null);
    await reload();
    onChanged();
  }

  async function setKind(linkId: string, kind: ChildKind) {
    setNotice(null);
    await after(await api.updateParentChild(treeId, linkId, { kind }));
  }

  const kindSelect = (linkId: string, kind: ChildKind, label: string) =>
    caps.edit ? (
      <select
        aria-label={`Link kind for ${label}`}
        value={kind}
        onChange={(e) => void setKind(linkId, e.target.value as ChildKind)}
      >
        {CHILD_KINDS.map((k) => (
          <option key={k} value={k}>
            {CHILD_KIND_LABEL[k]}
          </option>
        ))}
      </select>
    ) : kind !== 'biological' ? (
      <> ({CHILD_KIND_LABEL[kind]})</>
    ) : null;

  const removeLink = (linkId: string) =>
    caps.delete && (
      <ConfirmButton
        label="Remove link"
        confirmLabel="Yes, move to Trash"
        onConfirm={() =>
          void (async () => after(await api.deleteParentChild(treeId, linkId), 'Moved to Trash.'))()
        }
      />
    );

  const siblingGroups = rel.parents.map((p) => ({
    union: p,
    siblings: rel.siblings.filter((s) => s.unionId === p.union.id),
  }));

  return (
    <div>
      <FormError>{error}</FormError>
      {notice && <Success>{notice}</Success>}

      <h3>Parents</h3>
      {rel.parents.length === 0 && <p>No parents recorded.</p>}
      {rel.parents.map((p) => (
        <div key={p.linkId} className="relation-block">
          <p>
            <strong>Parents ({CHILD_KIND_LABEL[p.kind]})</strong>:{' '}
            {p.parents.length > 0
              ? p.parents.map((x, i) => (
                  <span key={x.id}>
                    {i > 0 && ' and '}
                    {person(x)}
                  </span>
                ))
              : null}
            {p.parents.length < 2 && (p.parents.length > 0 ? ' and ' : '') + 'Unknown parent'}{' '}
            {kindSelect(p.linkId, p.kind, names(p.parents, 'parents'))} {removeLink(p.linkId)}
          </p>
        </div>
      ))}

      <h3>Partners and children</h3>
      {rel.unions.length === 0 && <p>No partners recorded.</p>}
      {rel.unions.map((u) => (
        <div key={u.id} className="relation-block">
          <p>
            <strong>
              {u.partner ? person(u.partner) : 'Unknown partner'}: {UNION_TYPE_LABEL[u.type]},{' '}
              {UNION_STATUS_LABEL[u.status]}
            </strong>
            {unionDates(u)}
          </p>
          {editingUnion === u.id ? (
            <UnionForm
              union={u}
              onCancel={() => setEditingUnion(null)}
              onSubmit={async (input) => {
                const res = await api.updateUnion(treeId, u.id, input);
                if (res.ok) setEditingUnion(null);
                await after(res);
              }}
            />
          ) : (
            <p className="actions">
              {caps.edit && (
                <button type="button" className="secondary" onClick={() => setEditingUnion(u.id)}>
                  Edit relationship
                </button>
              )}
              {caps.delete && (
                <ConfirmButton
                  label="Remove relationship"
                  confirmLabel="Yes, move to Trash"
                  onConfirm={() =>
                    void (async () =>
                      after(await api.deleteUnion(treeId, u.id), 'Moved to Trash.'))()
                  }
                />
              )}
            </p>
          )}
          <ul>
            {u.children.map((c) => (
              <li key={c.linkId}>
                {person(c.person)} {kindSelect(c.linkId, c.kind, personName(c.person))}{' '}
                {removeLink(c.linkId)}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h3>Siblings</h3>
      {rel.siblings.length === 0 && <p>No siblings recorded.</p>}
      {siblingGroups.map(
        (g) =>
          g.siblings.length > 0 && (
            <div key={g.union.union.id}>
              {rel.parents.length > 1 && <p>With {names(g.union.parents, 'unknown parents')}:</p>}
              <ul>
                {g.siblings.map((s) => (
                  <li key={s.person.id}>
                    {person(s.person)}
                    {s.kind !== 'biological' && ` (${CHILD_KIND_LABEL[s.kind]})`}
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      {caps.addRelative && (
        <>
          <p className="actions">
            {ROLES.map(({ as, label }) => (
              <button
                key={as}
                type="button"
                className="secondary"
                disabled={as === 'sibling' && rel.parents.length === 0}
                onClick={() => setAdding(as)}
              >
                {label}
              </button>
            ))}
          </p>
          {rel.parents.length === 0 && <p className="hint">Add a parent first</p>}
          {adding && (
            <AddRelativeForm
              key={adding}
              treeId={treeId}
              subject={view}
              as={adding}
              persons={persons}
              onCancel={() => setAdding(null)}
              onDone={() => {
                setAdding(null);
                void reload();
                onChanged();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

const names = (people: PersonSummary[], fallback: string) =>
  people.length > 0 ? people.map(personName).join(' and ') : fallback;

function unionDates(u: Union): string {
  const from = formatFuzzyDate(u.startDate);
  const to = formatFuzzyDate(u.endDate);
  if (from && to) return ` from ${from} to ${to}`;
  if (from) return ` from ${from}`;
  if (to) return ` until ${to}`;
  return '';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function UnionForm({
  union,
  onSubmit,
  onCancel,
}: {
  union: Union;
  onSubmit: (input: Parameters<ReturnType<typeof useTreesApi>['updateUnion']>[2]) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<string>(union.type);
  const [status, setStatus] = useState<string>(union.status);
  const [start, setStart] = useState<FuzzyDraft>(toDraft(union.startDate));
  const [end, setEnd] = useState<FuzzyDraft>(toDraft(union.endDate));
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    const change: Record<string, unknown> = {};
    if (type !== union.type) change.type = type;
    if (status !== union.status) change.status = status;
    const startDate = fromDraft(start);
    const endDate = fromDraft(end);
    if (!same(startDate, fromDraft(toDraft(union.startDate)))) change.startDate = startDate;
    if (!same(endDate, fromDraft(toDraft(union.endDate)))) change.endDate = endDate;
    if (Object.keys(change).length === 0) return onCancel();
    const v = validate(updateUnionSchema, change);
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    await onSubmit(change as Parameters<typeof onSubmit>[0]);
  }

  const select = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    options: Record<string, string>,
  ) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => set(e.target.value)}>
        {Object.entries(options).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)}>
      {select(
        'union-type',
        'Type',
        type,
        setType,
        Object.fromEntries(UNION_TYPES.map((k) => [k, UNION_TYPE_LABEL[k]])),
      )}
      {select(
        'union-status',
        'Status',
        status,
        setStatus,
        Object.fromEntries(UNION_STATUSES.map((k) => [k, UNION_STATUS_LABEL[k]])),
      )}
      <FuzzyDateField label="Start" value={start} onChange={setStart} error={errors.startDate} />
      <FuzzyDateField label="End" value={end} onChange={setEnd} error={errors.endDate} />
      <p className="actions">
        <button type="submit">Save relationship</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
