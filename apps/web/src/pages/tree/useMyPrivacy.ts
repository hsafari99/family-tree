import type { MyPrivacy, PrivacySettingsInput } from '@family-tree/shared';
import { useCallback, useEffect, useState } from 'react';
import { useTreesApi } from '../../trees/TreesApiContext';

export type MyPrivacyState = {
  settings: MyPrivacy['settings'];
  /** Saves; true when it worked (the error is in `error` otherwise). */
  save: (patch: Partial<PrivacySettingsInput>) => Promise<boolean>;
  status: 'idle' | 'saving' | 'saved';
  error: string | null;
};

/**
 * The signed-in member's privacy, but only while `personId` is their own card (privacy spec R8);
 * null on anyone else's card or until it has loaded.
 */
export function useMyPrivacy(treeId: string, personId: string): MyPrivacyState | null {
  const api = useTreesApi();
  const [settings, setSettings] = useState<MyPrivacy['settings'] | null>(null);
  const [status, setStatus] = useState<MyPrivacyState['status']>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSettings(null);
    void api.getMyPrivacy(treeId).then((res) => {
      if (live && res.ok && res.data.personId === personId) setSettings(res.data.settings);
    });
    return () => {
      live = false;
    };
  }, [api, treeId, personId]);

  const save = useCallback(
    async (patch: Partial<PrivacySettingsInput>) => {
      if (!settings) return false;
      const next = { ...settings, ...patch };
      const body = { ...next, steps: next.level === 'branch' ? (next.steps ?? 2) : null };
      const before = settings;
      setSettings(body);
      setStatus('saving');
      setError(null);
      const res = await api.setMyPrivacy(treeId, body);
      if (res.ok) {
        setStatus('saved');
        return true;
      }
      setSettings(before);
      setStatus('idle');
      setError(res.error.message);
      return false;
    },
    [api, treeId, settings],
  );

  return settings ? { settings, save, status, error } : null;
}
