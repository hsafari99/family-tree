import { PHOTO_MEDIA_TYPES } from '@family-tree/shared';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { PhotoCropper } from '../../photos/PhotoCropper';
import { usePhotoActions } from '../../photos/usePhotoActions';
import { formatBytes, personName } from '../../trees/format';
import type { TabProps } from './usePersonSave';

export function PhotosTab(props: TabProps) {
  const { view } = props;
  const canEdit = view.capabilities.edit;
  const photos = usePhotoActions(props);
  const { file, busy, error, done, input } = photos;
  const name = personName(view.person);

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
              {/* Under the picture (clear of the main photo's outline): the badge or a small
                  Make main photo link, then Delete. */}
              {(ph.isPrimary || canEdit) && (
                <p className="photo-meta">
                  {ph.isPrimary ? (
                    <span className="badge pill">Main photo</span>
                  ) : (
                    <button
                      type="button"
                      className="link"
                      disabled={busy}
                      onClick={() => void photos.makeMain(ph.id)}
                    >
                      Make main photo
                    </button>
                  )}
                  {canEdit && (
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Delete photo"
                      danger
                      compact
                      pending={busy}
                      onConfirm={() => void photos.remove(ph.id)}
                    />
                  )}
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
            onDone={(b) => void photos.upload(b)}
            onCancel={photos.cancel}
          />
        ) : (
          <p>
            <label className="file-button">
              Add a photo{' '}
              <input
                ref={input}
                type="file"
                accept={PHOTO_MEDIA_TYPES.join(',')}
                onChange={(e) => photos.choose(e.target.files?.[0])}
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
