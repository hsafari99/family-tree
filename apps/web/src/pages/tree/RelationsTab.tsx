import {
  CHILD_KINDS,
  type ChildKind,
  type PersonSummary,
  type PersonView,
  RELATIVE_ROLES,
  type RelativeRole,
} from '@family-tree/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import { type MenuItem, MenuButton } from '../../components/MenuButton';
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
import { ChangeParents } from './ChangeParents';
import { UnionForm } from './UnionForm';
import type { TabProps } from './usePersonSave';

type Union = PersonView['relations']['unions'][number];

const ROLE_ITEM: Record<RelativeRole, string> = {
  parent: 'Parent',
  partner: 'Partner',
  child: 'Child',
  sibling: 'Sibling',
};

/** What a row shows in place of its summary: one thing at a time (brief #12). */
type RowMode =
  | { key: string; mode: 'kind' }
  | { key: string; mode: 'confirm' }
  | { key: string; mode: 'parents' }
  | { key: string; mode: 'edit' };

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
  const [adding, setAdding] = useState<RelativeRole | null>(requested);
  // A card's "+" button arrives as ?add=<role>.
  // (Derived during render, not in an effect: a mount effect could run after a click and undo it.)
  const [seenRequest, setSeenRequest] = useState(requested);
  if (seenRequest !== requested) {
    setSeenRequest(requested);
    setAdding(requested);
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
  const [row, setRow] = useState<RowMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { relations: rel, capabilities: caps } = view;
  const person = (p: PersonSummary) => <Link to={hrefOf(p.id)}>{personName(p)}</Link>;
  const root = useRef<HTMLDivElement>(null);

  const [busy, setBusy] = useState(false);

  /** Focus back to a row's menu button after its inline step closes. */
  const refocus = (key: string) =>
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(key)}"] .menu-trigger`)
        ?.focus(),
    );
  const closeRow = (key: string) => {
    setRow(null);
    refocus(key);
  };

  /** Runs one change at a time: the controls are disabled until it and the reload finish. */
  async function run(
    call: () => Promise<{ ok: boolean; error?: { message: string } }>,
    message?: string,
  ) {
    if (busy) return false;
    setBusy(true);
    try {
      const res = await call();
      if (!alive.current) return false;
      if (!res.ok) {
        setError(res.error?.message ?? null);
        return false;
      }
      setError(null);
      setNotice(message ?? null);
      setRow(null);
      await reload();
      onChanged();
      return true;
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const modeOf = (key: string) => (row?.key === key ? row.mode : null);

  const kindBadge = (kind: ChildKind) =>
    kind !== 'biological' && <span className="badge">{CHILD_KIND_LABEL[kind]}</span>;

  /** The inline link-kind select, shown after "Change link kind…". */
  const kindPicker = (key: string, linkId: string, kind: ChildKind, label: string) => (
    <span className="row-inline">
      <select
        aria-label={`Link kind for ${label}`}
        disabled={busy}
        value={kind}
        autoFocus
        onChange={(e) =>
          void run(() =>
            api.updateParentChild(treeId, linkId, { kind: e.target.value as ChildKind }),
          ).then((ok) => ok && refocus(key))
        }
      >
        {CHILD_KINDS.map((k) => (
          <option key={k} value={k}>
            {CHILD_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <button type="button" className="secondary compact" onClick={() => closeRow(key)}>
        Done
      </button>
    </span>
  );

  const confirmRemove = (key: string, call: () => Promise<{ ok: boolean }>) => (
    <ConfirmButton
      startAsking
      compact
      danger
      label="Remove"
      confirmLabel="Yes, move to Trash"
      pending={busy}
      onConfirm={() => void run(call, 'Moved to Trash.')}
      onCancel={() => closeRow(key)}
    />
  );

  /** A row: its summary and one "⋯" menu, or the inline step the menu opened. */
  const actionRow = (
    key: string,
    menuLabel: string,
    main: ReactNode,
    items: (MenuItem | false)[],
    inline: ReactNode,
  ) => {
    const shown = items.filter((i): i is MenuItem => i !== false);
    return (
      <li key={key} data-row={key}>
        <div className="row-main">{main}</div>
        <div className="row-actions">
          {inline ?? (shown.length > 0 && <MenuButton label={menuLabel} items={shown} />)}
        </div>
      </li>
    );
  };

  const siblingGroups = rel.parents.map((p) => ({
    union: p,
    siblings: rel.siblings.filter((s) => s.unionId === p.union.id),
  }));

  return (
    <div ref={root}>
      <FormError>{error}</FormError>
      {notice && <Success>{notice}</Success>}

      <h3>Parents</h3>
      {rel.parents.length === 0 && <p>No parents recorded.</p>}
      {rel.parents.length > 0 && (
        <ul className="row-list" aria-label="Parents">
          {rel.parents.map((p) => {
            const key = `parent:${p.linkId}`;
            const label = names(p.parents, 'unknown parents');
            const mode = modeOf(key);
            return mode === 'parents' ? (
              <li key={key} data-row={key}>
                <div className="row-form">
                  <ChangeParents
                    name={personName(view.person)}
                    options={p.moveTo}
                    pending={busy}
                    onMove={(unionId) =>
                      void run(
                        () => api.reparentLink(treeId, p.linkId, unionId),
                        'Parents changed.',
                      )
                    }
                    onCancel={() => closeRow(key)}
                  />
                </div>
              </li>
            ) : (
              actionRow(
                key,
                `More actions for ${label}`,
                <>
                  <span>
                    {p.parents.length === 0
                      ? 'Parents unknown'
                      : p.parents.map((x, i) => (
                          <span key={x.id}>
                            {i > 0 && ' and '}
                            {person(x)}
                          </span>
                        ))}
                    {p.parents.length === 1 && ' and Unknown parent'}
                  </span>
                  {kindBadge(p.kind)}
                </>,
                [
                  caps.edit && {
                    label: 'Change link kind…',
                    onSelect: () => setRow({ key, mode: 'kind' }),
                  },
                  caps.edit &&
                    p.moveTo.length > 0 && {
                      label: 'Change parents…',
                      onSelect: () => setRow({ key, mode: 'parents' }),
                    },
                  caps.delete && {
                    label: 'Remove link',
                    danger: true,
                    onSelect: () => setRow({ key, mode: 'confirm' }),
                  },
                ],
                mode === 'kind'
                  ? kindPicker(key, p.linkId, p.kind, label)
                  : mode === 'confirm'
                    ? confirmRemove(key, () => api.deleteParentChild(treeId, p.linkId))
                    : null,
              )
            );
          })}
        </ul>
      )}

      <h3>Partners and children</h3>
      {rel.unions.length === 0 && <p>No partners recorded.</p>}
      {rel.unions.map((u) => {
        const key = `union:${u.id}`;
        const partnerName = u.partner ? personName(u.partner) : 'an unknown partner';
        const mode = modeOf(key);
        return (
          <section key={u.id} className="relation-block" aria-label={`With ${partnerName}`}>
            <ul className="row-list">
              {mode === 'edit' ? (
                <li key={key} data-row={key}>
                  <div className="row-form">
                    <UnionForm
                      union={u}
                      pending={busy}
                      onCancel={() => closeRow(key)}
                      onSubmit={async (input) => {
                        await run(() => api.updateUnion(treeId, u.id, input));
                      }}
                    />
                  </div>
                </li>
              ) : (
                actionRow(
                  key,
                  `More actions for the relationship with ${partnerName}`,
                  <>
                    <strong>{u.partner ? person(u.partner) : 'Unknown partner'}</strong>
                    <span className="row-meta">
                      {UNION_TYPE_LABEL[u.type]}
                      {unionDates(u)} ({UNION_STATUS_LABEL[u.status].toLowerCase()})
                    </span>
                  </>,
                  [
                    caps.edit && {
                      label: 'Edit relationship',
                      onSelect: () => setRow({ key, mode: 'edit' }),
                    },
                    caps.delete && {
                      label: 'Remove relationship',
                      danger: true,
                      onSelect: () => setRow({ key, mode: 'confirm' }),
                    },
                  ],
                  mode === 'confirm'
                    ? confirmRemove(key, () => api.deleteUnion(treeId, u.id))
                    : null,
                )
              )}
            </ul>
            {u.children.length > 0 && (
              <ul className="row-list row-list-nested" aria-label={`Children with ${partnerName}`}>
                {u.children.map((c, i) => {
                  const ckey = `child:${c.linkId}`;
                  const name = personName(c.person);
                  const ids = u.children.map((x) => x.person.id);
                  const move = (by: -1 | 1) =>
                    void run(
                      () => api.reorderChildren(treeId, u.id, moved(ids, i, by)),
                      'Order saved.',
                    ).then((ok) => ok && refocus(ckey));
                  const showMove = caps.edit && u.children.length >= 2;
                  const cmode = modeOf(ckey);
                  return actionRow(
                    ckey,
                    `More actions for ${name}`,
                    <>
                      {person(c.person)}
                      {kindBadge(c.kind)}
                    </>,
                    [
                      caps.edit && {
                        label: 'Change link kind…',
                        onSelect: () => setRow({ key: ckey, mode: 'kind' }),
                      },
                      showMove && i > 0 && { label: 'Move earlier', onSelect: () => move(-1) },
                      showMove &&
                        i < u.children.length - 1 && {
                          label: 'Move later',
                          onSelect: () => move(1),
                        },
                      caps.delete && {
                        label: 'Remove link',
                        danger: true,
                        onSelect: () => setRow({ key: ckey, mode: 'confirm' }),
                      },
                    ],
                    cmode === 'kind'
                      ? kindPicker(ckey, c.linkId, c.kind, name)
                      : cmode === 'confirm'
                        ? confirmRemove(ckey, () => api.deleteParentChild(treeId, c.linkId))
                        : null,
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <h3>Siblings</h3>
      {rel.siblings.length === 0 && <p>No siblings recorded.</p>}
      {siblingGroups.map(
        (g) =>
          g.siblings.length > 0 && (
            <div key={g.union.union.id}>
              {rel.parents.length > 1 && <p>With {names(g.union.parents, 'unknown parents')}:</p>}
              <ul className="row-list">
                {g.siblings.map((s) => (
                  <li key={s.person.id}>
                    <div className="row-main">
                      {person(s.person)}
                      {kindBadge(s.kind)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      {caps.addRelative && (
        <>
          <p className="actions">
            <MenuButton
              label="Add relative"
              text="Add relative"
              className="compact"
              items={RELATIVE_ROLES.map((as) => ({
                label: ROLE_ITEM[as],
                onSelect: () => setAdding(as),
              }))}
            />
          </p>
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
