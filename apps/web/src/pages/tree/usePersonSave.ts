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

/** A save's outcome; `fields` are the server's VALIDATION keys, for the tab to map onto its fields. */
export type SaveResult = { ok: true } | { ok: false; fields?: string[] };

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

  async function save(fields: Omit<UpdatePersonInput, 'version'>): Promise<SaveResult> {
    setError(null);
    setStale(false);
    setSaved(false);
    setPending(true);
    const res = await api.updatePerson(treeId, view.person.id, {
      ...fields,
      version: view.person.version,
    });
    if (!alive.current) return { ok: false };
    setPending(false);
    if (!res.ok) {
      if (res.error.code === 'CONFLICT') setStale(true);
      // Field keys are shown at the fields (and in the summary) by the tab instead.
      else if (res.error.fields) return { ok: false, fields: res.error.fields };
      else setError(res.error.message);
      return { ok: false };
    }
    await reload();
    if (!alive.current) return { ok: true };
    setSaved(true);
    onChanged();
    return { ok: true };
  }

  async function loadLatest() {
    await reload();
    if (alive.current) setStale(false);
  }

  return { save, loadLatest, pending, error, stale, saved, staleMessage: MESSAGES.staleEdit };
}
