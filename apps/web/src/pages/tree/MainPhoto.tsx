import { PHOTO_MEDIA_TYPES } from '@family-tree/shared';
import { useRef, useState } from 'react';
import { avatarTone } from '../../canvas/avatar-tone';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TrashIcon, UploadIcon } from '../../components/icons';
import { FormError, Success } from '../../components/forms';
import { PersonPhoto } from '../../components/PersonPhoto';
import { PhotoCropper } from '../../photos/PhotoCropper';
import { usePhotoActions } from '../../photos/usePhotoActions';
import { personName } from '../../trees/format';
import type { TabProps } from './usePersonSave';

/**
 * The person's main photo at the top of Details (their initials when there is none). With edit
 * rights: Change photo (upload a new one, which becomes the main photo, or pick one of their other
 * photos) and Remove photo (deletes it; the next photo, if any, becomes the main one). The same
 * pipeline as the Photos section.
 */
export function MainPhoto(props: TabProps) {
  const { view } = props;
  const canEdit = view.capabilities.edit;
  const photos = usePhotoActions(props);
  const [changing, setChanging] = useState(false);
  const [asking, setAsking] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const name = personName(view.person);
  const main = view.photos.find((p) => p.isPrimary) ?? null;
  const others = view.photos.filter((p) => !p.isPrimary);

  const stop = () => {
    photos.cancel();
    setChanging(false);
    // The panel the button was in comes back; focus goes to it.
    requestAnimationFrame(() => changeButton.current?.focus());
  };
  const after = (ok: boolean) => {
    if (ok) stop();
  };

  return (
    <div
      className={changing ? 'details-photo is-changing' : 'details-photo'}
      role="group"
      aria-label="Main photo"
    >
      <PersonPhoto
        url={main?.thumbUrl ?? null}
        person={view.person}
        className="details-photo-img"
        tone={avatarTone(view.person.id)}
        alt={main ? `Main photo of ${name}` : ''}
      />
      <div className="details-photo-side">
        <FormError>{photos.error}</FormError>
        {photos.done && <Success>{photos.done}</Success>}
        {/* Like the profile picture in Account: small icon-and-word links; Remove asks first. */}
        {canEdit && !changing && (
          <p className="details-photo-actions">
            <button
              type="button"
              ref={changeButton}
              className="link-button"
              title="Change photo"
              aria-label="Change photo"
              disabled={photos.busy}
              onClick={() => {
                setChanging(true);
                requestAnimationFrame(() => photos.input.current?.focus());
              }}
            >
              <UploadIcon />
              Change
            </button>
            {main && (
              <button
                type="button"
                className="link-button danger"
                title="Remove photo"
                aria-label="Remove photo"
                disabled={photos.busy}
                onClick={() => setAsking(true)}
              >
                <TrashIcon />
                Remove
              </button>
            )}
          </p>
        )}
        {main && (
          <ConfirmDialog
            open={asking}
            title="Remove this photo?"
            confirmLabel="Remove"
            danger
            pending={photos.busy}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false);
              void photos.remove(main.id).then(after);
            }}
          >
            <p>It is deleted. Their next photo, if they have one, becomes the main photo.</p>
          </ConfirmDialog>
        )}
        {canEdit && changing && (
          <div className="details-photo-change">
            {photos.file ? (
              <PhotoCropper
                file={photos.file}
                busy={photos.busy}
                onDone={(b) => void photos.upload(b, { asMain: true }).then(after)}
                onCancel={photos.cancel}
              />
            ) : (
              <>
                <p>
                  <label className="file-button">
                    Upload a new photo{' '}
                    <input
                      ref={photos.input}
                      type="file"
                      accept={PHOTO_MEDIA_TYPES.join(',')}
                      onChange={(e) => photos.choose(e.target.files?.[0])}
                    />
                  </label>
                </p>
                {others.length > 0 && (
                  <>
                    <p className="hint">Or use one of their other photos:</p>
                    <ul className="photo-choices" aria-label="Their other photos">
                      {others.map((ph) => {
                        const n = view.photos.indexOf(ph) + 1;
                        return (
                          <li key={ph.id}>
                            <button
                              type="button"
                              className="photo-choice"
                              aria-label={`Use photo ${n} as the main photo`}
                              disabled={photos.busy}
                              onClick={() => void photos.makeMain(ph.id).then(after)}
                            >
                              <PersonPhoto
                                url={ph.thumbUrl}
                                person={view.person}
                                className="photo-choice-img"
                              />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <p>
                  <button type="button" className="link" onClick={stop}>
                    Cancel
                  </button>
                </p>
              </>
            )}
          </div>
        )}
        <p role="status" className="sr-only">
          {photos.busy ? 'Working…' : ''}
        </p>
      </div>
    </div>
  );
}
