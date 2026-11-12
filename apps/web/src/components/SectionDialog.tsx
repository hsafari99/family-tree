import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A modal for a longer piece of content (a person's section, brief #15), on a native <dialog> like
 * ConfirmDialog. Mounted means open: it calls showModal() on mount, so the page behind is inert and
 * focus moves to the close button. Esc, the X button or the browser's own close request call
 * `onClose`, except Esc from a form field, which would lose a draft. Portalled to <body>, so a collapsed (display: none) panel can't hide it.
 *
 * A dialog opened from inside this one (ConfirmDialog, say) handles its own Esc: React passes its
 * `cancel` up the component tree, so only a cancel aimed at this dialog closes it.
 */
export function SectionDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    // Chrome closes a dialog without a cancel event on a repeated Esc: keep state in step.
    // (A close event queued by an earlier close() -- StrictMode's effect re-run -- can arrive after
    // showModal() reopened it: only a dialog that really is closed counts.)
    const closed = () => {
      if (!dialog.open) latest.current();
    };
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className="section-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        // Esc in a form field doesn't throw away a half-filled form (the X still closes).
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest('input, select, textarea')) return;
        onClose();
      }}
    >
      <div className="section-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div className="section-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}

export function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 3.5l9 9m0-9l-9 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function ChevronIcon({ direction = 'right' }: { direction?: 'right' | 'up' }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      style={direction === 'up' ? { transform: 'rotate(-90deg)' } : undefined}
    >
      <path
        d="M6 3.5l4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
