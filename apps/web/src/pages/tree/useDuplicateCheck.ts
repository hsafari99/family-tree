import type { PersonSummary, SimilarQuery } from '@family-tree/shared';
import { useCallback, useRef, useState } from 'react';
import { useTreesApi } from '../../trees/TreesApiContext';

/**
 * The duplicate check (spec §6, decision 9). `check` resolves true when it's fine to create:
 * no likely match, the user already said "No, add a new person" for exactly this input, or the
 * check itself failed (it never blocks adding).
 */
export function useDuplicateCheck(treeId: string, excludeIds: readonly string[]) {
  const api = useTreesApi();
  const [matches, setMatches] = useState<PersonSummary[] | null>(null);
  // A ref, not state: "No, add a new person" must take effect in the same event (no stale closure).
  const confirmedNew = useRef<string | null>(null);

  const check = useCallback(
    async (q: SimilarQuery): Promise<boolean> => {
      const key = JSON.stringify(q);
      if (confirmedNew.current === key) return true;
      const res = await api.findSimilar(treeId, q);
      if (!res.ok) return true;
      const found = res.data.filter((p) => !excludeIds.includes(p.id));
      if (found.length === 0) return true;
      setMatches(found);
      return false;
    },
    [api, treeId, excludeIds],
  );
  const confirmNew = (q: SimilarQuery) => {
    confirmedNew.current = JSON.stringify(q);
    setMatches(null);
  };
  return { matches, check, confirmNew, dismiss: () => setMatches(null) };
}

/** The check's query from the quick-add fields: the year of the birth date, when it has one. */
export function similarQueryOf(v: {
  givenName: string;
  surname: string;
  birth: { date1: string };
}): SimilarQuery {
  const year = v.birth.date1.slice(0, 4);
  return {
    givenName: v.givenName.trim(),
    ...(v.surname.trim() ? { surname: v.surname.trim() } : {}),
    ...(/^\d{4}$/.test(year) ? { birthYear: Number(year) } : {}),
  };
}
