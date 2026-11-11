import type { ReactNode } from 'react';

/** The centred card every page sits in; `wide` is for the members page, `full` for the tree canvas. */
export function Page({
  title,
  wide = false,
  full = false,
  back,
  children,
}: {
  title: string;
  wide?: boolean;
  full?: boolean;
  /** A link shown before the title, top left (e.g. back to home). */
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="page">
      <div className={full ? 'card card-full' : wide ? 'card card-wide' : 'card'}>
        {back ? (
          <div className="page-title-row">
            {back}
            <h1>{title}</h1>
          </div>
        ) : (
          <h1>{title}</h1>
        )}
        {children}
      </div>
    </main>
  );
}
