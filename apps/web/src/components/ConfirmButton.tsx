import { useEffect, useRef, useState } from 'react';

/** A destructive action behind an inline two-step confirm (no window.confirm: it blocks browser automation). */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  pending = false,
  danger = false,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  danger?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (wasAsking.current) startRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const cls = danger ? 'danger' : undefined;

  if (!asking) {
    return (
      <button
        ref={startRef}
        type="button"
        className={cls}
        disabled={pending}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
      <button
        ref={confirmRef}
        type="button"
        className={cls}
        disabled={pending}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>{' '}
      <button type="button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
