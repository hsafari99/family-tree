import type { PersonSummary, TreeDetail } from '@family-tree/shared';
import { Link } from 'react-router';
import { personName, personYears } from '../../trees/format';

export function PeopleList({
  treeId,
  persons,
  detail,
  selectedId,
}: {
  treeId: string;
  persons: PersonSummary[];
  detail: TreeDetail;
  selectedId: string | undefined;
}) {
  const { me, capabilities } = detail;
  return (
    <section className="people-list">
      <h2>People ({persons.length})</h2>
      <p className="hint">The interactive family tree arrives in a later version.</p>
      {(capabilities.editAnywhere || me.steward.active) && (
        <p>
          <Link to={`/trees/${treeId}/people/new`}>Add a person</Link>
        </p>
      )}
      <ul>
        {persons.map((p) => {
          const years = personYears(p);
          return (
            <li key={p.id}>
              <Link
                to={`/trees/${treeId}/people/${p.id}`}
                aria-current={p.id === selectedId ? 'page' : undefined}
              >
                {personName(p)}
                {years && ` ${years}`}
              </Link>
              {p.id === me.personId && ' (you)'}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
