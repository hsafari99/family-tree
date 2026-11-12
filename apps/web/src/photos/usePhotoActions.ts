import {
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  type PhotoMediaType,
} from '@family-tree/shared';
import { useRef, useState } from 'react';
import { MESSAGES, type Result } from '../auth/api';
import type { TabProps } from '../pages/tree/usePersonSave';
import { useTreesApi } from '../trees/TreesApiContext';
import { type CropBox, cropToBlob } from './crop';

/**
 * A person's photo pipeline, shared by the Photos section and the main photo in Details: choose a
 * file (checked for type and size), crop and upload it, set a photo as the main one, or delete it.
 * Each success re-reads the person and tells the page.
 */
export function usePhotoActions({ treeId, view, reload, onChanged }: TabProps) {
  const api = useTreesApi();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const finish = async (message: string) => {
    setDone(message);
    await reload();
    onChanged();
  };

  function choose(f: File | undefined) {
    setError(null);
    setDone(null);
    if (!f) return;
    if (!PHOTO_MEDIA_TYPES.includes(f.type as PhotoMediaType)) return setError(MESSAGES.photoType);
    if (f.size > PHOTO_UPLOAD_MAX_BYTES) return setError(MESSAGES.photoTooLarge);
    setFile(f);
  }

  function cancel() {
    setFile(null);
    if (input.current) input.current.value = '';
  }

  /** Uploads the chosen file (cropped to `box`); `asMain` then makes it the main photo. */
  async function upload(box: CropBox | null, { asMain = false } = {}): Promise<boolean> {
    if (!file) return false;
    setBusy(true);
    setError(null);
    let body: Blob;
    try {
      body = await cropToBlob(file, box);
    } catch {
      setBusy(false);
      setError(MESSAGES.photoUnreadable);
      return false;
    }
    const res = await api.uploadPhoto(treeId, view.person.id, body);
    if (res.ok && asMain && !res.data.photo.isPrimary) {
      const main = await api.setPrimaryPhoto(treeId, res.data.photo.id);
      if (!main.ok) {
        // The photo is in; only making it main failed: say so, and show it among the photos.
        setBusy(false);
        cancel();
        setError(main.error.message);
        await reload();
        onChanged();
        return false;
      }
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return false;
    }
    cancel();
    await finish(asMain ? 'Main photo changed' : 'Photo added');
    return true;
  }

  async function act(call: Promise<Result<void>>, message: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await call;
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return false;
    }
    await finish(message);
    return true;
  }

  return {
    file,
    busy,
    error,
    done,
    input,
    choose,
    cancel,
    upload,
    makeMain: (photoId: string) => act(api.setPrimaryPhoto(treeId, photoId), 'Main photo changed'),
    remove: (photoId: string) => act(api.deletePhoto(treeId, photoId), 'Photo removed'),
  };
}
