import {
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  type PhotoMediaType,
} from '@family-tree/shared';
import { useRef, useState } from 'react';
import { MESSAGES, type Result } from '../../auth/api';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { type CropBox, cropToBlob } from '../../photos/crop';
import { PhotoCropper } from '../../photos/PhotoCropper';
import { formatBytes, personName } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';
import type { TabProps } from './usePersonSave';

export function PhotosTab({ treeId, view, reload, onChanged }: TabProps) {
  const api = useTreesApi();
  const canEdit = view.capabilities.edit;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const name = personName(view.person);

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

  async function upload(box: CropBox | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    let body: Blob;
    try {
      body = await cropToBlob(file, box);
    } catch {
      setBusy(false);
      return setError(MESSAGES.photoUnreadable);
    }
    const res = await api.uploadPhoto(treeId, view.person.id, body);
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    setFile(null);
    if (input.current) input.current.value = '';
    await finish('Photo added');
  }

  async function act(call: Promise<Result<void>>, message: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await call;
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    await finish(message);
  }

  return (
    <div className="photos-tab">
      <FormError>{error}</FormError>
      {done && <Success>{done}</Success>}
      {view.photos.length === 0 ? (
        <p>No photos yet.</p>
      ) : (
        <ul className="photo-grid" aria-label={`Photos of ${name}`}>
          {view.photos.map((ph, i) => (
            <li key={ph.id} className={ph.isPrimary ? 'photo is-primary' : 'photo'}>
              <a href={ph.fullUrl} target="_blank" rel="noopener noreferrer">
                <PersonPhoto
                  url={ph.thumbUrl}
                  person={view.person}
                  className="photo-thumb"
                  alt={`Photo ${i + 1} of ${name}${ph.isPrimary ? ', main photo' : ''} (opens full size)`}
                />
              </a>
              {ph.isPrimary && <span className="badge pill">Main photo</span>}
              {canEdit && (
                <p className="photo-actions">
                  {!ph.isPrimary && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(api.setPrimaryPhoto(treeId, ph.id), 'Main photo changed')
                      }
                    >
                      Make main photo
                    </button>
                  )}{' '}
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Delete photo"
                    danger
                    pending={busy}
                    onConfirm={() => void act(api.deletePhoto(treeId, ph.id), 'Photo removed')}
                  />
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">
        Photos use {formatBytes(view.photoUsage.usedBytes)} of this tree’s{' '}
        {formatBytes(view.photoUsage.limitBytes)}.
      </p>
      {canEdit &&
        (file ? (
          <PhotoCropper
            file={file}
            busy={busy}
            onDone={(b) => void upload(b)}
            onCancel={() => setFile(null)}
          />
        ) : (
          <p>
            <label className="file-button">
              Add a photo{' '}
              <input
                ref={input}
                type="file"
                accept={PHOTO_MEDIA_TYPES.join(',')}
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>{' '}
            <span className="hint">
              JPEG, PNG or WebP, up to 10 MB. Location and camera details are removed.
            </span>
          </p>
        ))}
      <p role="status">{busy ? 'Working…' : ''}</p>
    </div>
  );
}
