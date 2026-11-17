import type { Photo } from '@family-tree/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropClose } from '../components/backdrop';
import { ChevronIcon, XIcon } from '../components/icons';

/** A horizontal swipe at least this long (CSS px) turns the page. */
const SWIPE_MIN = 50;

/**
 * A person's photos as an album (feedback item 7): one photo at a time, full size, with Previous
 * and Next, the arrow keys, a swipe on touch screens and "3 of 8". A native modal <dialog> like
 * SectionDialog: Esc, the X or a click on the backdrop closes it. Stops at the first and last
 * photo rather than wrapping, so the counter always reads in order.
 */
export function PhotoViewer({
  photos,
  start,
  name,
  onClose,
}: {
  photos: readonly Photo[];
  start: number;
  /** The person's name, for the title and the alt text. */
  name: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), photos.length - 1));
  const latest = useRef(onClose);
  const swipeFrom = useRef<number | null>(null);
  const backdrop = useBackdropClose(() => latest.current());
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    const closed = () => {
      if (!dialog.open) latest.current();
    };
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
    };
  }, []);

  // The neighbours load in the background, so Next shows its photo at once.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      const p = photos[i];
      if (p) new Image().src = p.fullUrl;
    }
  }, [index, photos]);

  const photo = photos[index];
  if (!photo) return null;
  const count = photos.length;
  const go = (step: -1 | 1) => setIndex((i) => Math.min(Math.max(i + step, 0), count - 1));

  return createPortal(
    <dialog
      ref={ref}
      className="photo-viewer"
      aria-labelledby={titleId}
      {...backdrop}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
        else return;
        e.preventDefault();
      }}
    >
      <div className="photo-viewer-head">
        <h2 id={titleId}>Photos of {name}</h2>
        <p className="photo-viewer-count" aria-live="polite">
          {index + 1} of {count}
        </p>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close photos"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div
        className="photo-viewer-stage"
        onPointerDown={(e) => {
          swipeFrom.current = e.clientX;
        }}
        onPointerUp={(e) => {
          const from = swipeFrom.current;
          swipeFrom.current = null;
          if (from === null) return;
          const dx = e.clientX - from;
          if (Math.abs(dx) >= SWIPE_MIN) go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipeFrom.current = null;
        }}
      >
        <button
          type="button"
          className="photo-viewer-nav is-prev"
          aria-label="Previous photo"
          disabled={index === 0}
          onClick={() => go(-1)}
        >
          <ChevronIcon direction="left" />
        </button>
        <img
          key={photo.id}
          src={photo.fullUrl}
          alt={`Photo ${index + 1} of ${count} of ${name}${photo.isPrimary ? ', main photo' : ''}`}
          draggable={false}
        />
        <button
          type="button"
          className="photo-viewer-nav is-next"
          aria-label="Next photo"
          disabled={index === count - 1}
          onClick={() => go(1)}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>
      <p className="photo-viewer-foot">
        {photo.isPrimary && <span className="badge pill">Main photo</span>}{' '}
        <a href={photo.fullUrl} target="_blank" rel="noopener noreferrer">
          Open full size
        </a>
      </p>
    </dialog>,
    document.body,
  );
}
