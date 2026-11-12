import type { ReactNode } from 'react';

/**
 * A friendly "nothing here yet": a small drawing, a title, a line of help and the way forward.
 * The drawing is decorative; the title says it all.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  /** Replaces the default drawing (three linked people). */
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-art">{icon ?? <PeopleArt />}</div>
      <p className="empty-state-title">{title}</p>
      {body && <p className="empty-state-body">{body}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/** Three soft circles joined by family lines, in the theme's tokens. */
export function PeopleArt() {
  return (
    <svg viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round">
        <path d="M30 22h36M48 22v14M48 36H26v8M48 36h22v8" />
      </g>
      <circle cx="22" cy="20" r="10" fill="var(--av1)" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="74" cy="20" r="10" fill="var(--av2)" stroke="var(--surface)" strokeWidth="2" />
      <circle cx="48" cy="22" r="4" fill="var(--accent)" />
      <circle cx="26" cy="52" r="9" fill="var(--av3)" stroke="var(--surface)" strokeWidth="2" />
      <circle
        cx="70"
        cy="52"
        r="9"
        fill="var(--surface-2)"
        stroke="var(--line-strong)"
        strokeWidth="2"
        strokeDasharray="3 3"
      />
    </svg>
  );
}
