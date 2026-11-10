import type { ReactNode } from 'react';

/** The centred card every page sits in; `wide` is for the tree and members pages. */
export function Page({
  title,
  wide = false,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className="page">
      <div className={wide ? 'card card-wide' : 'card'}>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
