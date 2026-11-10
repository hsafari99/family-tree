import type { PersonSummary } from '@family-tree/shared';
import { useId } from 'react';
import { personName, personYears } from '../../trees/format';

export function DuplicatePrompt({
  matches,
  pending,
  onUse,
  onCreateNew,
}: {
  matches: PersonSummary[];
  pending: boolean;
  onUse: (p: PersonSummary) => void;
  onCreateNew: () => void;
}) {
  const id = useId();
  return (
    <section className="duplicate-check" role="group" aria-labelledby={id}>
      <h3 id={id}>Is this someone already in the tree?</h3>
      <ul>
        {matches.map((p) => {
          const name = personName(p);
          const years = personYears(p);
          return (
            <li key={p.id}>
              Is this the existing person {name}
              {years && ` (${years})`}?{' '}
              <button
                type="button"
                aria-label={`Yes, use ${name}`}
                disabled={pending}
                onClick={() => onUse(p)}
              >
                Yes, use them
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="secondary" disabled={pending} onClick={onCreateNew}>
        No, add a new person
      </button>
    </section>
  );
}
