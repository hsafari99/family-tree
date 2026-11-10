import type { PersonSummary } from '@family-tree/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { personName, personYears } from '../trees/format';

/** Spec §6: people the tree can't reach from its starting person, behind a toggle. */
export function DisconnectedPeople({
  persons,
  hrefOf,
}: {
  persons: PersonSummary[];
  hrefOf: (personId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  if (persons.length === 0) return null;
  return (
    <div className="disconnected">
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls="disconnected-list"
        onClick={() => setOpen((o) => !o)}
      >
        Disconnected people ({persons.length})
      </button>
      {open && (
        <div id="disconnected-list" className="disconnected-list">
          <p className="hint">Not connected to the starting person through any relationship.</p>
          <ul>
            {persons.map((p) => {
              const years = personYears(p);
              return (
                <li key={p.id}>
                  <Link to={hrefOf(p.id)}>
                    {personName(p)}
                    {years && ` ${years}`}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
