import { useEffect, useState } from 'react';
import { useTreesApi } from '../../trees/TreesApiContext';
import { ahnentafel } from '../fan/ahnentafel';

/**
 * Where the illustrated tree grows from when the URL names no one (Task 17): the start person's
 * oldest ancestor up the first parent's line, at most `gens - 1` steps up, so the start person is
 * still in the tree. Null while it is being worked out (or when `startId` is null).
 */
export function useTreeAnchor(
  treeId: string,
  startId: string | null,
  gens: number,
  enabled: boolean,
): string | null {
  const api = useTreesApi();
  const [found, setFound] = useState<{ key: string; id: string } | null>(null);
  const key = `${treeId}/${startId}/${gens}`;
  useEffect(() => {
    if (!enabled || !startId) return;
    if (gens <= 1) return void setFound({ key, id: startId });
    const controller = new AbortController();
    void api
      .getGraph(
        treeId,
        { mode: 'ancestors', focus: startId, generations: gens - 1 },
        controller.signal,
      )
      .then((res) => {
        if (controller.signal.aborted) return;
        if (!res.ok) return setFound({ key, id: startId });
        const slots = ahnentafel(res.data, startId, gens - 1);
        let n = 1;
        while (slots.has(2 * n) || slots.has(2 * n + 1)) n = slots.has(2 * n) ? 2 * n : 2 * n + 1;
        setFound({ key, id: slots.get(n)! });
      });
    return () => controller.abort();
  }, [api, treeId, startId, gens, enabled, key]);
  if (!enabled || !startId) return null;
  return found?.key === key ? found.id : null;
}
