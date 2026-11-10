import type { PersonSummary, TreeDetail } from '@family-tree/shared';
import { Link } from 'react-router';
import { usePersonHref } from '../../canvas/params';
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
  const { me } = detail;
  const hrefOf = usePersonHref(treeId);
  return (
    <section className="people-list">
      <h2>People ({persons.length})</h2>
      <ul>
        {persons.map((p) => {
          const years = personYears(p);
          return (
            <li key={p.id}>
              <Link to={hrefOf(p.id)} aria-current={p.id === selectedId ? 'page' : undefined}>
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
