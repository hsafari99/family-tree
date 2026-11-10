import type { PersonSummary, TreeDetail } from '@family-tree/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmButton } from '../components/ConfirmButton';
import { FormError } from '../components/forms';
import { Page } from '../components/Page';
import { personName, personYears } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';

const ROLE_LINE = {
  owner: 'You are the owner of this tree.',
  editor: 'You are an editor of this tree.',
  viewer: 'You are a viewer of this tree.',
} as const;

export function TreePage() {
  const { treeId = '' } = useParams();
  const api = useTreesApi();
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

  if (error) {
    return (
      <Page title="Tree" wide>
        <FormError>{error.message}</FormError>
        <p>
          <Link to="/">Back to your trees</Link>
        </p>
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
  const rootName = nameOf(tree.rootPersonId);
  const anchors = me.steward.grants.map((g) => nameOf(g.anchorPersonId) ?? 'someone').join(', ');

  return (
    <Page title={tree.name} wide>
      <p>{ROLE_LINE[me.role]}</p>
      {me.steward.grants.length > 0 &&
        (me.steward.active ? (
          <p>You look after the branches of: {anchors}</p>
        ) : (
          <p role="status" className="notice">
            You&apos;ve been made a branch steward. Turn on two-step verification in Account
            settings to start using it.
          </p>
        ))}
      {rootName && <p>Starting person: {rootName}</p>}

      <section>
        <h2>People ({persons.length})</h2>
        <p className="hint">The interactive family tree arrives in a later version.</p>
        <ul>
          {persons.map((p) => {
            const years = personYears(p);
            return (
              <li key={p.id}>
                {personName(p)}
                {years && ` ${years}`}
                {p.id === me.personId && ' (you)'}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="actions">
        <Link to={`/trees/${treeId}/members`}>Members and invites</Link>
        <Link to="/">Your trees</Link>
      </p>

      {capabilities.manageTree && (
        <Settings
          treeId={treeId}
          detail={detail}
          persons={persons}
          onUpdated={(patch) => setDetail((d) => (d ? { ...d, tree: { ...d.tree, ...patch } } : d))}
        />
      )}
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
  useEffect(() => setName(detail.tree.name), [detail.tree.name]);

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
    <section>
      <h2>Tree settings</h2>
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
      <h3>Delete this tree</h3>
      <p>Deleting hides the tree from everyone. You can restore it from Your trees for 30 days.</p>
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
