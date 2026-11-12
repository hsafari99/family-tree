import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBackdropClose, useUnsavedInput } from './backdrop';
import { XIcon } from './icons';

/**
 * A modal for a longer piece of content (a person's section, brief #15), on a native <dialog> like
 * ConfirmDialog. Mounted means open: it calls showModal() on mount, so the page behind is inert and
 * focus moves to the close button. Esc, the X button or the browser's own close request call
 * `onClose`, except Esc from a form field, which would lose a draft. Portalled to <body>, so a collapsed (display: none) panel can't hide it.
 *
 * A dialog opened from inside this one (ConfirmDialog, say) handles its own Esc: React passes its
 * `cancel` up the component tree, so only a cancel aimed at this dialog closes it.
 *
 * A click on the backdrop (outside the dialog's box) closes it too, but only when the press also
 * started there (a text selection dragged out of the dialog doesn't), and never while a field
 * inside holds unsaved input: then only Esc (outside a field) or the X closes it.
 */
export function SectionDialog({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Room for a table (Members and invites, the Trash). */
  wide?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const latest = useRef(onClose);
  const unsaved = useUnsavedInput(ref);
  const backdrop = useBackdropClose(
    () => latest.current(),
    () => !unsaved(),
  );
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
      className={wide ? 'section-dialog is-wide' : 'section-dialog'}
      aria-labelledby={titleId}
      {...backdrop}
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
