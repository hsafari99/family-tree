import type { GraphUnionView, PersonSummary } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FormError } from '../../components/forms';
import {
  formatFuzzyDate,
  personName,
  UNION_STATUS_LABEL,
  UNION_TYPE_LABEL,
} from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import { UnionForm } from './UnionForm';

/** Spec §6 "Union node ●": clicking it edits the union's type, status and dates. */
export function UnionPanel({
  treeId,
  union,
  loading,
  persons,
  onChanged,
}: {
  treeId: string;
  union: GraphUnionView | undefined;
  loading: boolean;
  persons: PersonSummary[];
  onChanged: () => void;
}) {
  const api = useTreesApi();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (!union) {
    return loading ? (
      <p>Loading…</p>
    ) : (
      <div>
        <p>This relationship isn’t in the current view.</p>
        <p>
          <Link to={`/trees/${treeId}`}>Back to the tree</Link>
        </p>
      </div>
    );
  }
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : 'Unknown partner';
  };
  if (union.parentsUnknown && union.partnerAId === null && union.partnerBId === null) {
    return (
      <div className="union-panel">
        <h2>Siblings with unknown parents</h2>
        <p>These siblings’ parents aren’t recorded.</p>
      </div>
    );
  }
  const from = formatFuzzyDate(union.startDate);
  const to = formatFuzzyDate(union.endDate);
  return (
    <div className="union-panel">
      <h2>
        {nameOf(union.partnerAId)} and {nameOf(union.partnerBId)}
      </h2>
      <p>
        {UNION_TYPE_LABEL[union.type]}, {UNION_STATUS_LABEL[union.status]}
        {from && ` from ${from}`}
        {to && ` to ${to}`}
      </p>
      <FormError>{error}</FormError>
      {saved && (
        <p role="status" className="success">
          Saved
        </p>
      )}
      {union.canEdit &&
        (editing ? (
          <UnionForm
            union={union}
            pending={pending}
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              setPending(true);
              const res = await api.updateUnion(treeId, union.id, input);
              if (!alive.current) return;
              setPending(false);
              if (!res.ok) return setError(res.error.message);
              setError(null);
              setEditing(false);
              setSaved(true);
              onChanged();
            }}
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            Edit relationship
          </button>
        ))}
    </div>
  );
}
