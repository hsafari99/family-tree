import type { PersonSummary, TreeDetail } from '@family-tree/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams } from 'react-router';
import { useHeaderTree } from '../components/AppHeader';
import { ConfirmButton } from '../components/ConfirmButton';
import { FormError } from '../components/forms';
import { Page } from '../components/Page';
import { TreeWorkspace } from './tree/TreeWorkspace';
import { startDownload } from '../trees/download';
import { personName } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';

/**
 * Keyed by the tree, so going from one tree to another (the header's switcher) starts the page
 * afresh: no render pairs the new tree's id with the old tree's details (which would open the old
 * tree's default person in the new tree), and per-tree state like hidden branches is re-read.
 */
export function TreePage() {
  const { treeId = '' } = useParams();
  return <TreePageFor key={treeId} />;
}

function TreePageFor() {
  const { treeId = '' } = useParams();
  const newPerson = useMatch('/trees/:treeId/people/new') !== null;
  const api = useTreesApi();
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  const [detail, setDetail] = useState<TreeDetail | null>(null);
  const [persons, setPersons] = useState<PersonSummary[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setPersons([]);
    setError(null);
    void Promise.all([api.getTree(treeId), api.listPersons(treeId)]).then(([t, p]) => {
      if (!active) return;
      if (!t.ok) return setError(t.error);
      if (!p.ok) return setError(p.error);
      setDetail(t.data);
      setPersons(p.data);
    });
    return () => {
      active = false;
    };
  }, [api, treeId]);

  // A notice passed through the router state (e.g. after a delete) shows once.
  useEffect(() => {
    const state = location.state as { notice?: string } | null;
    if (state?.notice) {
      setNotice(state.notice);
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  // The header names the tree (and follows a rename), so the page's own h1 is for screen readers.
  useHeaderTree(detail?.tree.id ?? null, detail?.tree.name ?? null);

  const refreshPersons = useCallback(async () => {
    const res = await api.listPersons(treeId);
    if (res.ok) setPersons(res.data);
  }, [api, treeId]);
  // After "This is me" or a member change: the cards marked as you and as others' accounts.
  const refreshDetail = useCallback(async () => {
    const res = await api.getTree(treeId);
    if (res.ok) setDetail(res.data);
  }, [api, treeId]);

  if (error) {
    return (
      <Page title="Tree" wide>
        <FormError>{error.message}</FormError>
      </Page>
    );
  }
  if (!detail) {
    return (
      <Page title="Tree" wide>
        <p>Loading…</p>
      </Page>
    );
  }

  const { tree, me, capabilities } = detail;
  const nameOf = (id: string | null) => {
    const p = persons.find((x) => x.id === id);
    return p ? personName(p) : null;
  };
  const anchors = me.steward.grants.map((g) => nameOf(g.anchorPersonId) ?? 'someone').join(', ');

  return (
    <Page title={tree.name} full hideTitle>
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {me.steward.grants.length > 0 &&
        (me.steward.active ? (
          <p>You look after the branches of: {anchors}</p>
        ) : (
          <p role="status" className="notice">
            You&apos;ve been made a branch steward.{' '}
            <Link to="/account/two-step">Turn on two-step verification</Link> to start using it.
          </p>
        ))}

      {newPerson && !(capabilities.editAnywhere || me.steward.active) && (
        <p role="alert" className="error">
          You can’t add people to this tree
        </p>
      )}
      <TreeWorkspace
        treeId={treeId}
        detail={detail}
        persons={persons}
        onPersonsChanged={() => void refreshPersons()}
        onDetailChanged={() => void refreshDetail()}
        settings={
          capabilities.manageTree ? (
            <Settings
              treeId={treeId}
              detail={detail}
              persons={persons}
              onUpdated={(patch) =>
                setDetail((d) => (d ? { ...d, tree: { ...d.tree, ...patch } } : d))
              }
            />
          ) : null
        }
      />
    </Page>
  );
}

function Settings({
  treeId,
  detail,
  persons,
  onUpdated,
}: {
  treeId: string;
  detail: TreeDetail;
  persons: PersonSummary[];
  onUpdated: (patch: Partial<TreeDetail['tree']>) => void;
}) {
  const api = useTreesApi();
  const navigate = useNavigate();
  const [name, setName] = useState(detail.tree.name);
  const [rootId, setRootId] = useState(detail.tree.rootPersonId ?? '');
  const [typed, setTyped] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Keep the field in step if the loaded name changes (e.g. after a save).
  // (Derived during render: a mount effect could run after the user's first keystroke and undo it.)
  const [seenName, setSeenName] = useState(detail.tree.name);
  if (seenName !== detail.tree.name) {
    setSeenName(detail.tree.name);
    setName(detail.tree.name);
  }

  async function save(e: FormEvent, input: { name: string } | { rootPersonId: string }) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    setPending(true);
    const res = await api.updateTree(treeId, input);
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onUpdated(input);
    setSaved('Saved');
  }

  async function remove() {
    setError(null);
    setPending(true);
    const res = await api.deleteTree(treeId);
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    void navigate('/');
  }

  return (
    <section aria-label="Tree settings">
      <FormError>{error}</FormError>
      {saved && (
        <p role="status" className="success">
          {saved}
        </p>
      )}
      <form onSubmit={(e) => save(e, { name: name.trim() })}>
        <div className="field">
          <label htmlFor="tree-name">Tree name</label>
          <input id="tree-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" disabled={pending || name.trim() === ''}>
          Save name
        </button>
      </form>
      <form onSubmit={(e) => save(e, { rootPersonId: rootId })}>
        <div className="field">
          <label htmlFor="tree-root">Starting person</label>
          <select id="tree-root" value={rootId} onChange={(e) => setRootId(e.target.value)}>
            {rootId === '' && <option value="">Choose…</option>}
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={pending || rootId === ''}>
          Save starting person
        </button>
      </form>
      <ExportSection treeId={treeId} />
      <h3>Delete this tree</h3>
      <p>Deleting hides the tree from everyone. You can restore it from My trees for 30 days.</p>
      <div className="field">
        <label htmlFor="tree-delete-confirm">Type the tree name to confirm</label>
        <input id="tree-delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <ConfirmButton
        label="Delete tree"
        confirmLabel="Yes, delete this tree"
        danger
        disabled={typed !== detail.tree.name}
        pending={pending}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

/** Owner only (spec §4): the whole tree as one ZIP (decisions 2, 5, 9). */
function ExportSection({ treeId }: { treeId: string }) {
  const api = useTreesApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setError(null);
    setDone(false);
    setPending(true);
    const res = await api.exportTree(treeId);
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    startDownload(res.data.url);
    setDone(true);
  }

  return (
    <section aria-labelledby="export-heading">
      <h3 id="export-heading">Export</h3>
      <p>
        Download everything in this tree as one ZIP file: <code>tree.ged</code> (GEDCOM, which most
        family-tree programs can open), the photos, and <code>tree.json</code> (a complete copy of
        the data). It includes details of living relatives, so keep it private.
      </p>
      <FormError>{error}</FormError>
      {done && (
        <p role="status" className="success">
          Your export is downloading.
        </p>
      )}
      <button type="button" disabled={pending} onClick={() => void run()}>
        {pending ? 'Preparing export…' : 'Download export'}
      </button>
    </section>
  );
}
