import type { ReactNode } from 'react';
import { ChevronIcon } from '../components/SectionDialog';

/**
 * The inside of a side-panel row (a person's section or a tree row): one line, the title, an
 * optional small muted count, and a trailing icon (a chevron by default: it opens here).
 */
export function RowContent({
  title,
  count,
  icon = <ChevronIcon />,
}: {
  title: string;
  count?: number | null;
  icon?: ReactNode;
}) {
  return (
    <>
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
