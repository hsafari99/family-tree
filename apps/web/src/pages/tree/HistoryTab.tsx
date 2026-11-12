import type { HistoryEntry } from '@family-tree/shared';
import { useEffect, useState } from 'react';
import { useTreesApi } from '../../trees/TreesApiContext';
import { ACTION_LABEL, FIELD_LABEL, formatValue } from '../../trees/format';
import { FormError } from '../../components/forms';

export function HistoryTab({ treeId, personId }: { treeId: string; personId: string }) {
  const api = useTreesApi();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setEntries(null);
    setError(null);
    void api.personHistory(treeId, personId).then((res) => {
      if (!active) return;
      if (res.ok) setEntries(res.data);
      else setError(res.error.message);
    });
    return () => {
      active = false;
    };
  }, [api, treeId, personId]);

  if (error) return <FormError>{error}</FormError>;
  if (!entries) return <p>Loading…</p>;
  if (entries.length === 0) return <p>No changes recorded yet.</p>;
  return (
    <ul className="history">
      {entries.map((e) => (
        <li key={e.id}>
          <strong>{ACTION_LABEL[e.action]}</strong>{' '}
          <span className="hint">
            {new Date(e.at).toLocaleString()} by {e.by ?? 'a former member'}
          </span>
          {e.changes.length > 0 && (
            <ul>
              {e.changes.map((c) => (
                <li key={c.field}>
                  {FIELD_LABEL[c.field] ?? c.field}: {formatValue(c.before, c.field)} →{' '}
                  {formatValue(c.after, c.field)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
