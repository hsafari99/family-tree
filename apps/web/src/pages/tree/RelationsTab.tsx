import {
  CHILD_KINDS,
  type ChildKind,
  type PersonSummary,
  type PersonView,
  RELATIVE_ROLES,
  type RelativeRole,
} from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import {
  CHILD_KIND_LABEL,
  formatFuzzyDate,
  personName,
  UNION_STATUS_LABEL,
  UNION_TYPE_LABEL,
} from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { AddRelativeForm } from './AddRelativeForm';
import { usePersonHref } from '../../canvas/params';
import { UnionForm } from './UnionForm';
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
  const hrefOf = usePersonHref(treeId);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [params, setParams] = useSearchParams();
  const requested = RELATIVE_ROLES.find((r) => r === params.get('add')) ?? null;
  const noParents = view.relations.parents.length === 0;
  const startAdding = requested === 'sibling' && noParents ? null : requested;
  const [adding, setAdding] = useState<RelativeRole | null>(startAdding);
  // A card's "+" button arrives as ?add=<role>.
  // (Derived during render, not in an effect: a mount effect could run after a click and undo it.)
  const [seenRequest, setSeenRequest] = useState(startAdding);
  if (seenRequest !== startAdding) {
    setSeenRequest(startAdding);
    setAdding(startAdding);
  }
  const stopAdding = () => {
    setAdding(null);
    if (params.has('add')) {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('add');
          return next;
        },
        { replace: true },
      );
    }
  };
  const [editingUnion, setEditingUnion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { relations: rel, capabilities: caps } = view;
  const person = (p: PersonSummary) => <Link to={hrefOf(p.id)}>{personName(p)}</Link>;

  const [busy, setBusy] = useState(false);

  /** Runs one change at a time: the controls are disabled until it and the reload finish. */
  async function run(
    call: () => Promise<{ ok: boolean; error?: { message: string } }>,
    message?: string,
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await call();
      if (!alive.current) return;
      if (!res.ok) return setError(res.error?.message ?? null);
      setError(null);
      setNotice(message ?? null);
      await reload();
      onChanged();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const setKind = (linkId: string, kind: ChildKind) =>
    run(() => api.updateParentChild(treeId, linkId, { kind }));

  const kindSelect = (linkId: string, kind: ChildKind, label: string) =>
    caps.edit ? (
      <select
        aria-label={`Link kind for ${label}`}
        disabled={busy}
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
        pending={busy}
        onConfirm={() => void run(() => api.deleteParentChild(treeId, linkId), 'Moved to Trash.')}
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
              {u.partner ? person(u.partner) : 'Unknown partner'}: {UNION_TYPE_LABEL[u.type]}
            </strong>
            {unionDates(u)} ({UNION_STATUS_LABEL[u.status].toLowerCase()})
          </p>
          {editingUnion === u.id ? (
            <UnionForm
              union={u}
              pending={busy}
              onCancel={() => setEditingUnion(null)}
              onSubmit={(input) =>
                run(async () => {
                  const res = await api.updateUnion(treeId, u.id, input);
                  if (res.ok) setEditingUnion(null);
                  return res;
                })
              }
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
                  pending={busy}
                  onConfirm={() => void run(() => api.deleteUnion(treeId, u.id), 'Moved to Trash.')}
                />
              )}
            </p>
          )}
          <ul>
            {u.children.map((c, i) => {
              const ids = u.children.map((x) => x.person.id);
              const move = (by: -1 | 1) =>
                void run(
                  () => api.reorderChildren(treeId, u.id, moved(ids, i, by)),
                  'Order saved.',
                );
              const showMove = caps.edit && u.children.length >= 2;
              return (
                <li key={c.linkId}>
                  {person(c.person)} {kindSelect(c.linkId, c.kind, personName(c.person))}{' '}
                  {showMove && i > 0 && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      aria-label={`Move ${personName(c.person)} earlier`}
                      onClick={() => move(-1)}
                    >
                      Move earlier
                    </button>
                  )}{' '}
                  {showMove && i < u.children.length - 1 && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      aria-label={`Move ${personName(c.person)} later`}
                      onClick={() => move(1)}
                    >
                      Move later
                    </button>
                  )}{' '}
                  {removeLink(c.linkId)}
                </li>
              );
            })}
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
              onCancel={stopAdding}
              onDone={() => {
                stopAdding();
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

/** `ids` with the item at `index` swapped with its neighbour. */
function moved(ids: string[], index: number, by: -1 | 1): string[] {
  const next = [...ids];
  [next[index], next[index + by]] = [next[index + by]!, next[index]!];
  return next;
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
