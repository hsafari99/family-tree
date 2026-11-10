import type { PersonView, UpdatePersonInput } from '@family-tree/shared';
import { useEffect, useRef, useState } from 'react';
import { MESSAGES } from '../../auth/api';
import { useTreesApi } from '../../trees/TreesApiContext';

export interface TabProps {
  treeId: string;
  view: PersonView;
  /** Re-reads the person (and keeps showing the old view meanwhile). */
  reload: () => Promise<void>;
  /** Tells the page the list of people may have changed. */
  onChanged: () => void;
}

/** Saving person fields with the stale-version handling shared by the Info and Places tabs. */
export function usePersonSave({ treeId, view, reload, onChanged }: TabProps) {
  const api = useTreesApi();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(fields: Omit<UpdatePersonInput, 'version'>): Promise<boolean> {
    setError(null);
    setStale(false);
    setSaved(false);
    setPending(true);
    const res = await api.updatePerson(treeId, view.person.id, {
      ...fields,
      version: view.person.version,
    });
    if (!alive.current) return false;
    setPending(false);
    if (!res.ok) {
      if (res.error.code === 'CONFLICT') setStale(true);
      else setError(res.error.message);
      return false;
    }
    await reload();
    if (!alive.current) return true;
    setSaved(true);
    onChanged();
    return true;
  }

  async function loadLatest() {
    await reload();
    if (alive.current) setStale(false);
  }

  return { save, loadLatest, pending, error, stale, saved, staleMessage: MESSAGES.staleEdit };
}
