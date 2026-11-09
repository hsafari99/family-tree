import type { ReactNode } from 'react';

/** The centred card every page sits in. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="page">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
