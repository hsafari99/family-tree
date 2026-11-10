import type { ReactNode } from 'react';

/** The centred card every page sits in; `wide` is for the members page, `full` for the tree canvas. */
export function Page({
  title,
  wide = false,
  full = false,
  children,
}: {
  title: string;
  wide?: boolean;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="page">
      <div className={full ? 'card card-full' : wide ? 'card card-wide' : 'card'}>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
