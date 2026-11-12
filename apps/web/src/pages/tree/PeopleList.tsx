import type { PersonSummary, TreeDetail } from '@family-tree/shared';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { canvasSearch, usePersonHref } from '../../canvas/params';
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
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Centres the canvas on someone in the focus view; the panel (path, tab) is left as it is.
  const showOnTree = (id: string) => {
    void navigate(`${pathname}${canvasSearch(params, { focus: id, view: null })}`);
    document.querySelector('.canvas-area')?.scrollIntoView?.({ block: 'start' });
  };
  return (
    <section className="people-list">
      <h2>People ({persons.length})</h2>
      <ul className="row-list" aria-label="People">
        {persons.map((p) => {
          const name = personName(p);
          const years = personYears(p);
          return (
            <li key={p.id}>
              <span className="row-main">
                <Link to={hrefOf(p.id)} aria-current={p.id === selectedId ? 'page' : undefined}>
                  {name}
                </Link>
                {years && <span className="row-meta">{years}</span>}
                {p.id === me.personId && <span className="badge pill">You</span>}
              </span>
              <span className="row-actions">
                <button
                  type="button"
                  className="secondary compact"
                  aria-label={`Show ${name} on tree`}
                  onClick={() => showOnTree(p.id)}
                >
                  Show on tree
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
