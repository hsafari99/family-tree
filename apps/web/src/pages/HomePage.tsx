import type {
  ActivityEntry,
  HomeSummary,
  HomeTree,
  LinkRequest,
  Today,
  TodayPerson,
} from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, PeopleArt } from '../components/EmptyState';
import { avatarTone } from '../canvas/avatar-tone';
import { FormError } from '../components/forms';
import { PersonPhoto } from '../components/PersonPhoto';
import { Page } from '../components/Page';
import { TreeCardsSkeleton } from '../components/Skeleton';
import { ACTION_LABEL, countPeople, ROLE_LABEL, timeAgo } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';
import { hasSupport, SUPPORT_PATH } from '../support/config';
import { useSupport } from '../support/SupportContext';
import { LINK_SUMMARY } from './members/LinkedTreesSection';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The viewer's own calendar day as MM-DD (their time zone, not the server's). */
export const localDay = (d = new Date()) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Today's birthdays and days of passing across the user's trees (feedback item 6): full names
 * only, each linking to the person. Shows nothing when there is nobody today or the call fails.
 */
function TodayCard() {
  const api = useTreesApi();
  const [today, setToday] = useState<Today | null>(null);
  useEffect(() => {
    let live = true;
    void api.today(localDay()).then((res) => {
      if (live && res.ok) setToday(res.data);
    });
    return () => {
      live = false;
    };
  }, [api]);
  if (!today || (today.birthdays.length === 0 && today.remembering.length === 0)) return null;
  // A picture per person (their photo, or initials on their own colour); the name shows on
  // hover and focus, and is the link's accessible name.
  const list = (people: TodayPerson[]) => (
    <ul className="today-list">
      {people.map((p) => (
        <li key={`${p.treeId}:${p.personId}`}>
          <Link
            to={`/trees/${p.treeId}/people/${p.personId}`}
            className="today-person"
            aria-label={p.name}
          >
            <PersonPhoto
              url={p.photoThumbUrl}
              person={{ ...p, middleName: null }}
              className="today-avatar"
              tone={avatarTone(p.personId)}
            />
            <span className="today-name" aria-hidden="true">
              {p.name}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="card today-card" aria-labelledby="home-today">
      <h2 id="home-today">Today</h2>
      {today.birthdays.length > 0 && (
        <div>
          <h3>Birthdays</h3>
          {list(today.birthdays)}
        </div>
      )}
      {today.remembering.length > 0 && (
        <div>
          <h3>Remembering</h3>
          {list(today.remembering)}
        </div>
      )}
    </section>
  );
}

/**
 * Requests to link one of the user's trees with another, waiting for them as its owner (tree
 * linking spec, Web: Home page). Accept and Decline right here; Review opens the Members dialog.
 */
function LinkRequests() {
  const api = useTreesApi();
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api.linkRequests();
    if (r.ok) setRequests(r.data);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (r: LinkRequest, accept: boolean) => {
    setError(null);
    const res = accept
      ? await api.acceptLink(r.treeId, r.linkId)
      : await api.declineLink(r.treeId, r.linkId);
    if (!res.ok) return setError(res.error.message);
    setDone(
      accept
        ? `Accepted. ${r.treeName} and ${r.otherTreeName} are linked once both owners agree.`
        : 'Request declined.',
    );
    await load();
  };
  if (requests.length === 0 && !done && !error) return null;
  return (
    <section className="card link-requests" aria-labelledby="home-link-requests">
      <h2 id="home-link-requests">Link requests</h2>
      <FormError>{error}</FormError>
      {done && <p role="status">{done}</p>}
      <ul>
        {requests.map((r) => (
          <li key={`${r.linkId}/${r.treeId}`}>
            <p>
              {r.bridgeName} wants to link <strong>{r.treeName}</strong> with{' '}
              <strong>{r.otherTreeName}</strong> ({countPeople(r.otherPeopleCount)}).
            </p>
            <p className="hint">{LINK_SUMMARY}</p>
            <p className="link-request-actions">
              <button type="button" onClick={() => void act(r, true)}>
                Accept
              </button>{' '}
              <button type="button" className="secondary" onClick={() => void act(r, false)}>
                Decline
              </button>{' '}
              <Link to={`/trees/${r.treeId}?tab=members`}>Review</Link>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Home: a welcome, the user's trees as cards, recent changes across them, and the deleted trees
 * they can restore; a short guide for a first-time user. RequireAuth sends everyone else to sign
 * in. One summary request (GET /api/v1/home) feeds the whole page.
 */
export function HomePage() {
  const { user, loadError } = useAuth();
  const api = useTreesApi();
  const support = hasSupport(useSupport());
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
        <div className="loading-region">
          <p className="sr-only">Loading…</p>
          <TreeCardsSkeleton />
        </div>
      ) : firstTime ? (
        <GettingStarted />
      ) : (
        <>
          <p className="home-lead">Pick up where you left off, or start another tree.</p>
          <LinkRequests />
          <TodayCard />
          <section aria-labelledby="home-trees">
            <div className="section-head">
              <h2 id="home-trees">Your trees</h2>
              <Link to="/trees/new" className="button-link">
                Start a new tree
              </Link>
            </div>
            {summary.trees.length === 0 ? (
              <EmptyState
                title="No trees open right now"
                body="You have no trees open right now. Restore one below or start a new one."
              />
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
      {/* One quiet line at the very end, for those who read that far. */}
      {support && summary && (
        <p className="home-support hint">
          Family Tree is free. If it helps your family, you can{' '}
          <Link to={SUPPORT_PATH}>support it</Link>.
        </p>
      )}
    </Page>
  );
}

function TreeCard({ tree: t }: { tree: HomeTree }) {
  const invites = t.openInvites ?? 0;
  return (
    <li className="tree-card">
      <div className="tree-card-head">
        {/* The name's link covers the whole card (::after), so a click anywhere opens it. */}
        <h3>
          <Link to={`/trees/${t.id}`} className="tree-card-link">
            {t.name}
          </Link>
        </h3>
        <span className="badge pill">{ROLE_LABEL[t.role]}</span>
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
      {invites > 0 && (
        <div className="tree-card-actions">
          <Link to={`/trees/${t.id}/members`} className="tree-card-invites">
            {invites === 1 ? '1 open invite' : `${invites} open invites`}
          </Link>
        </div>
      )}
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
      <div className="getting-started-art">
        <PeopleArt />
      </div>
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
