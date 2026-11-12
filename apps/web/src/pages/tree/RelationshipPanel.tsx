import {
  kinshipChain,
  kinshipTerm,
  type KinStep,
  type PersonSummary,
  type Relationship,
  type TreeDetail,
} from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MESSAGES } from '../../auth/api';
import { usePersonHref } from '../../canvas/params';
import { FormError } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { PersonPicker } from '../../components/PersonPicker';
import { personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';

/** The headline and, when a term exists, the chain under it (decisions 21, 24). */
export function describeRelationship(rel: Relationship, meId: string | null) {
  const first = rel.persons[0]!;
  const last = rel.persons.at(-1)!;
  const steps = rel.steps ?? [];
  const possessive = first.id === meId ? 'your' : `${personName(first)}’s`;
  const term = kinshipTerm(steps);
  const chain = kinshipChain(steps, possessive);
  return term
    ? { headline: `${personName(last)} is ${possessive} ${term}.`, chain }
    : { headline: `${personName(last)} is ${chain}.`, chain: null };
}

type State =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rel: Relationship };

export function RelationshipPanel({
  treeId,
  detail,
  persons,
  onShow,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onShow: (fromId: string, steps: KinStep[]) => void;
}) {
  const api = useTreesApi();
  const hrefOf = usePersonHref(treeId);
  const [params, setParams] = useSearchParams();
  const meId = detail.me.personId;
  const from = params.get('from') || meId || detail.tree.rootPersonId;
  const to = params.get('to');
  const [state, setState] = useState<State>({ status: 'idle' });

  const choose = (key: 'from' | 'to') => (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set(key, id);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (!from || !to) return setState({ status: 'idle' });
    let active = true;
    setState({ status: 'loading' });
    void api.relationship(treeId, from, to).then((r) => {
      if (!active) return;
      setState(
        r.ok
          ? { status: 'ready', rel: r.data }
          : {
              status: 'error',
              message: r.error.code === 'NOT_FOUND' ? MESSAGES.personNotFound : r.error.message,
            },
      );
    });
    return () => {
      active = false;
    };
  }, [api, treeId, from, to]);

  return (
    <div className="relationship-panel">
      <PersonPicker
        label="From"
        persons={persons}
        value={from}
        onChange={choose('from')}
        clearLabel="Change"
        clearAriaLabel="Change From"
      />
      <PersonPicker
        label="To"
        persons={persons}
        value={to}
        onChange={choose('to')}
        clearLabel="Change"
        clearAriaLabel="Change To"
      />
      <div aria-live="polite">
        {state.status === 'loading' && <p>Finding the path…</p>}
        {state.status === 'error' && <FormError>{state.message}</FormError>}
        {state.status === 'ready' && (
          <Result rel={state.rel} meId={meId} hrefOf={hrefOf} onShow={onShow} />
        )}
      </div>
    </div>
  );
}

function Result({
  rel,
  meId,
  hrefOf,
  onShow,
}: {
  rel: Relationship;
  meId: string | null;
  hrefOf: (id: string) => string;
  onShow: (fromId: string, steps: KinStep[]) => void;
}) {
  if (rel.steps === null) return <p>{MESSAGES.noRelationship}</p>;
  if (rel.steps.length === 0) return <p>That’s the same person.</p>;
  const { headline, chain } = describeRelationship(rel, meId);
  const steps = rel.steps;
  return (
    <>
      <p className="kin-headline">{headline}</p>
      {chain && <p>The path: {chain}</p>}
      <ol className="kin-path" aria-label="People on the path">
        {rel.persons.map((p) => (
          <li key={p.id}>
            <PersonPhoto url={p.photoThumbUrl} person={p} className="result-photo" />{' '}
            <Link to={hrefOf(p.id)}>{personName(p)}</Link>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => onShow(rel.persons[0]!.id, steps)}>
        Show on the tree
      </button>
    </>
  );
}
