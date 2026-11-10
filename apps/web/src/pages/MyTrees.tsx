import type { TreeList } from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTreesApi } from '../trees/TreesApiContext';

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;

export function MyTrees() {
  const api = useTreesApi();
  const [list, setList] = useState<TreeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await api.listTrees();
    if (!alive.current) return;
    if (res.ok) setList(res.data);
    else setError(res.error.message);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(id: string) {
    setRestoring(id);
    setRestoreError(null);
    const res = await api.restoreTree(id);
    if (!alive.current) return;
    setRestoring(null);
    if (!res.ok) {
      setRestoreError(res.error.message);
      return;
    }
    await load();
  }

  if (error) {
    return (
      <>
        <p role="alert" className="error">
          {error}
        </p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </>
    );
  }
  if (!list) return <p>Loading…</p>;

  return (
    <>
      {list.trees.length === 0 ? (
        <p>You don&apos;t have any trees yet.</p>
      ) : (
        <ul className="tree-list">
          {list.trees.map((t) => (
            <li key={t.id}>
              <Link to={`/trees/${t.id}`}>{t.name}</Link>
              <span className="role">{ROLE_LABEL[t.role]}</span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link to="/trees/new">Start a new tree</Link>
      </p>
      {list.deletedTrees.length > 0 && (
        <section>
          <h3>Deleted trees</h3>
          <ul className="tree-list">
            {list.deletedTrees.map((t) => (
              <li key={t.id}>
                {t.name}, can be restored until {new Date(t.restoreUntil).toLocaleDateString()}{' '}
                <button
                  type="button"
                  disabled={restoring === t.id}
                  onClick={() => void restore(t.id)}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          {restoreError && (
            <p role="alert" className="error">
              {restoreError}
            </p>
          )}
        </section>
      )}
    </>
  );
}
