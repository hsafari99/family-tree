import { type ReactNode, useEffect, useRef, useState } from 'react';

/** A destructive action behind an inline two-step confirm (no window.confirm: it blocks browser automation). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  pending = false,
  disabled = false,
  danger = false,
  startAsking = false,
  onCancel,
  compact = false,
  icon,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Stops the first click (the confirm step itself is not affected). */
  disabled?: boolean;
  danger?: boolean;
  /** Open straight on the confirm step (a menu's destructive item hands over to it). */
  startAsking?: boolean;
  /** Called when the confirm step is cancelled (Cancel or Escape). */
  onCancel?: () => void;
  compact?: boolean;
  /** Shows only this icon on the first step, with `label` as its name and tooltip. */
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(startAsking);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  const cancel = () => {
    setAsking(false);
    onCancel?.();
  };

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (wasAsking.current) startRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  // If the button becomes disabled while the confirm step is open, close the step.
  useEffect(() => {
    if (disabled) setAsking(false);
  }, [disabled]);

  const cls =
    [danger ? 'danger' : '', compact ? 'compact' : ''].filter(Boolean).join(' ') || undefined;

  if (!asking) {
    return (
      <button
        ref={startRef}
        type="button"
        className={icon ? [cls, 'icon-button'].filter(Boolean).join(' ') : cls}
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        disabled={pending || disabled}
        onClick={() => setAsking(true)}
      >
        {icon ?? label}
      </button>
    );
  }
  return (
    <span
      className="confirm"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <button
        ref={confirmRef}
        type="button"
        className={cls}
        disabled={pending || disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>{' '}
      <button type="button" className={compact ? 'secondary compact' : undefined} onClick={cancel}>
        Cancel
      </button>
    </span>
  );
}
