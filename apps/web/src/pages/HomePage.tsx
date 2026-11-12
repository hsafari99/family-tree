import type { ActivityEntry, HomeSummary, HomeTree } from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { FormError } from '../components/forms';
import { Page } from '../components/Page';
import { HealthStatus } from '../HealthStatus';
import { ACTION_LABEL, countPeople, timeAgo } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' } as const;

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Home: a welcome, the user's trees as cards, recent changes across them, and the deleted trees
 * they can restore; a short guide for a first-time user. RequireAuth sends everyone else to sign
 * in. One summary request (GET /api/v1/home) feeds the whole page.
 */
export function HomePage() {
  const { user, loadError } = useAuth();
  const api = useTreesApi();
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await api.homeSummary();
    if (!alive.current) return;
    if (res.ok) setSummary(res.data);
    else setError(res.error.message);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // RequireAuth only renders this page for a signed-in user.
  if (user === null || user === 'loading') return null;
  const firstTime =
    summary !== null && summary.trees.length === 0 && summary.deletedTrees.length === 0;

  return (
    <Page title={`Welcome, ${firstName(user.name)}`} wide>
      {loadError && (
        <p role="status" className="notice">
          Can’t reach the server right now
        </p>
      )}
      {error ? (
        <>
          <FormError>{error}</FormError>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </>
      ) : !summary ? (
        <p>Loading…</p>
      ) : firstTime ? (
        <GettingStarted />
      ) : (
        <>
          <p className="home-lead">Pick up where you left off, or start another tree.</p>
          <section aria-labelledby="home-trees">
            <div className="section-head">
              <h2 id="home-trees">Your trees</h2>
              <Link to="/trees/new" className="button-link">
                Start a new tree
              </Link>
            </div>
            {summary.trees.length === 0 ? (
              <p>You have no trees open right now. Restore one below or start a new one.</p>
            ) : (
              <ul className="tree-cards">
                {summary.trees.map((t) => (
                  <TreeCard key={t.id} tree={t} />
                ))}
              </ul>
            )}
          </section>
          {summary.trees.length > 0 && <RecentActivity entries={summary.activity} />}
          {summary.deletedTrees.length > 0 && (
            <DeletedTrees trees={summary.deletedTrees} onRestored={load} />
          )}
        </>
      )}
      <HealthStatus />
    </Page>
  );
}

function TreeCard({ tree: t }: { tree: HomeTree }) {
  const invites = t.openInvites ?? 0;
  return (
    <li className="tree-card">
      <div className="tree-card-head">
        <h3>{t.name}</h3>
        <span className="badge">{ROLE_LABEL[t.role]}</span>
      </div>
      <p className="tree-card-meta">
        <span>{countPeople(t.peopleCount)}</span>
        <span>
          Updated{' '}
          <time dateTime={t.updatedAt} title={new Date(t.updatedAt).toLocaleString()}>
            {timeAgo(t.updatedAt)}
          </time>
        </span>
      </p>
      <div className="tree-card-actions">
        <Link to={`/trees/${t.id}`} className="button-link" aria-label={`Open ${t.name}`}>
          Open
        </Link>
        {invites > 0 && (
          <Link to={`/trees/${t.id}/members`} className="tree-card-invites">
            {invites === 1 ? '1 open invite' : `${invites} open invites`}
          </Link>
        )}
      </div>
    </li>
  );
}

function RecentActivity({ entries }: { entries: ActivityEntry[] }) {
  return (
    <section aria-labelledby="home-activity">
      <h2 id="home-activity">Recent activity</h2>
      {entries.length === 0 ? (
        <p>No changes yet.</p>
      ) : (
        <ul className="row-list activity-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="activity-main">
                <strong>{ACTION_LABEL[e.action]}</strong>:{' '}
                <Link to={`/trees/${e.treeId}/people/${e.person.id}`}>{e.person.name}</Link>
                <span className="hint">
                  {' '}
                  in {e.treeName}, by {e.by ?? 'a former member'}
                </span>
              </span>
              <time className="hint" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                {timeAgo(e.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeletedTrees({
  trees,
  onRestored,
}: {
  trees: HomeSummary['deletedTrees'];
  onRestored: () => Promise<void>;
}) {
  const api = useTreesApi();
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function restore(id: string) {
    setRestoring(id);
    setError(null);
    const res = await api.restoreTree(id);
    setRestoring(null);
    if (!res.ok) return setError(res.error.message);
    await onRestored();
  }

  return (
    <section aria-labelledby="home-deleted">
      <h2 id="home-deleted">Deleted trees</h2>
      <ul className="row-list">
        {trees.map((t) => (
          <li key={t.id}>
            <span>
              {t.name}, can be restored until {new Date(t.restoreUntil).toLocaleDateString()}
            </span>
            <button
              type="button"
              className="secondary compact"
              disabled={restoring === t.id}
              onClick={() => void restore(t.id)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
      <FormError>{error}</FormError>
    </section>
  );
}

/** The first-time screen: what a tree is for here, in three steps, and the way in. */
function GettingStarted() {
  return (
    <section aria-labelledby="home-start" className="getting-started">
      <h2 id="home-start">Getting started</h2>
      <p>Build your family tree together with your relatives, privately.</p>
      <ol className="steps">
        <li>
          <strong>Start a tree.</strong> You are its first person. Tree owners use two-step
          verification, and we’ll help you turn it on.
        </li>
        <li>
          <strong>Add your family.</strong> Use the + on anyone’s card to add parents, partners,
          brothers, sisters and children.
        </li>
        <li>
          <strong>Invite relatives.</strong> From Members, send a link so they can view the tree or
          help fill it in.
        </li>
      </ol>
      <p>
        <Link to="/trees/new" className="button-link">
          Start a new tree
        </Link>
      </p>
      <p className="hint">
        Were you sent an invite link? Open it to join that tree; it will show up here.
      </p>
    </section>
  );
}
