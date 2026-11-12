import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { MAIN_ID } from './AppHeader';
import { ArrowLeftIcon } from './icons';

/** An icon-only link one level up, for Page's `back` (e.g. from Members to the tree). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="icon-link" aria-label={label} title={label}>
      <ArrowLeftIcon />
    </Link>
  );
}

/**
 * The centred card every page sits in, under the global header; `wide` is for the members page,
 * `full` for the tree canvas. `<main>` is the skip link's target. `hideTitle` keeps the h1 for
 * assistive tech only, where the header already shows the same name (the tree page).
 */
export function Page({
  title,
  wide = false,
  full = false,
  hideTitle = false,
  back,
  children,
}: {
  title: string;
  wide?: boolean;
  full?: boolean;
  hideTitle?: boolean;
  /** A link shown before the title, top left (e.g. back to the tree). */
  back?: ReactNode;
  children: ReactNode;
}) {
  const h1 = <h1 className={hideTitle ? 'sr-only' : undefined}>{title}</h1>;
  return (
    <main id={MAIN_ID} tabIndex={-1} className={full ? 'page page-full' : 'page'}>
      <div className={full ? 'card card-full' : wide ? 'card card-wide' : 'card'}>
        {back ? (
          <div className="page-title-row">
            {back}
            {h1}
          </div>
        ) : (
          h1
        )}
        {children}
      </div>
    </main>
  );
}
