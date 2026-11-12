import type { ReactNode } from 'react';
import { ChevronIcon } from '../components/icons';

/**
 * The inside of a side-panel row (a person's section or a tree row): one line, the title, an
 * optional small muted count, and a trailing icon (a chevron by default: it opens here).
 */
export function RowContent({
  title,
  count,
  icon = <ChevronIcon />,
  lead,
}: {
  title: string;
  /** A leading icon that names the row's kind at a glance. */
  lead?: ReactNode;
  count?: number | null;
  icon?: ReactNode;
}) {
  return (
    <>
      {lead && <span className="section-row-lead">{lead}</span>}
      <span className="section-row-title">{title}</span>
      {count != null && count > 0 && (
        <span className="section-row-count">
          <span className="sr-only">, </span>
          {count}
        </span>
      )}
      {icon}
    </>
  );
}
