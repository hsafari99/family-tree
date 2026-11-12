import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useBackdropClose } from './backdrop';

/**
 * A modal confirmation for a destructive action, on a native <dialog> (never window.confirm: it
 * blocks browser automation). While `open`, it is shown with showModal(): the rest of the page is
 * inert and focus starts on Cancel. Esc, Cancel or a click on the backdrop calls `onCancel`; focus then returns to where
 * it was before the dialog opened (usually the button that opened it).
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Optional explanation under the title. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const backdrop = useBackdropClose(onCancel, () => !pending);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Back where the user was, once it has closed (by Esc, Cancel or confirming).
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const restore = () => {
      const target = returnTo.current;
      returnTo.current = null;
      if (target?.isConnected) target.focus();
    };
    dialog.addEventListener('close', restore);
    return () => dialog.removeEventListener('close', restore);
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={titleId}
      {...(children ? { 'aria-describedby': bodyId } : {})}
      {...backdrop}
      onCancel={(e) => {
        // Esc: let React state close it, so `open` stays the source of truth.
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children && <div id={bodyId}>{children}</div>}
      <div className="actions">
        <button
          ref={cancelRef}
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'danger' : undefined}
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
