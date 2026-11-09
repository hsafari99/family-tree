import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page } from '../components/Page';
import { useTreesApi } from '../trees/TreesApiContext';

/** Placeholder until the tree overview page (Task 16). */
export function TreePage() {
  const { treeId = '' } = useParams();
  const api = useTreesApi();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.getTree(treeId).then((res) => {
      if (!active) return;
      if (res.ok) setName(res.data.tree.name);
      else setError(res.error.message);
    });
    return () => {
      active = false;
    };
  }, [api, treeId]);

  return (
    <Page title={name ?? 'Tree'} wide>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        <Link to="/">Back to home</Link>
      </p>
    </Page>
  );
}
