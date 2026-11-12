import type { TrashBatch, TrashBatchDetail, TreeDetail } from '@family-tree/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { TrashIcon } from '../components/icons';
import { FormError, Success } from '../components/forms';
import { useHeaderTree } from '../components/AppHeader';
import { BackLink, Page } from '../components/Page';
import { personName, personYears } from '../trees/format';
import { useTreesApi } from '../trees/TreesApiContext';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const join = (names: string[], fallback: string) =>
  names.length > 0 ? names.join(' and ') : fallback;

const UNKNOWN_PARENTS = 'Siblings with unknown parents';

function title(b: TrashBatch): string {
  const r = b.root;
  switch (r.kind) {
    case 'person':
      return b.mode === 'descendants' ? `${r.name} and their descendants` : r.name;
    case 'union':
      if (r.parentsUnknown && r.partners.length === 0) return UNKNOWN_PARENTS;
      return r.partners.length === 2
        ? `Relationship between ${r.partners[0]} and ${r.partners[1]}`
        : r.partners.length === 1
          ? `Relationship of ${r.partners[0]}`
          : 'Relationship';
    case 'link':
      return `${r.child ?? 'Someone'} as child of ${join(r.parents, 'unknown parents')}`;
  }
}

function counts(b: TrashBatch): string {
  return [
    b.people > 0 ? plural(b.people, 'person', 'people') : null,
    b.unions > 0 ? plural(b.unions, 'relationship', 'relationships') : null,
    b.links > 0 ? plural(b.links, 'link', 'links') : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function TrashPage() {
  const { treeId = '' } = useParams();
  const api = useTreesApi();
  const [tree, setTree] = useState<TreeDetail | null>(null);
  const [batches, setBatches] = useState<TrashBatch[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setBatches(null);
    setError(null);
    void Promise.all([api.getTree(treeId), api.listTrash(treeId)]).then(([t, l]) => {
      if (!active) return;
      if (!t.ok) return setError(t.error);
      setTree(t.data);
      if (!l.ok) return setError(l.error);
      setBatches(l.data);
    });
    return () => {
      active = false;
    };
  }, [api, treeId]);

  useHeaderTree(tree?.tree.id ?? null, tree?.tree.name ?? null);
  const back = (
    <BackLink
      to={`/trees/${treeId}`}
      label={tree ? `Back to ${tree.tree.name}` : 'Back to the tree'}
    />
  );

  if (error) {
    return (
      <Page title="Trash" wide back={back}>
        <FormError>{error.message}</FormError>
      </Page>
    );
  }
  if (!batches) {
    return (
      <Page title="Trash" wide back={back}>
        <p>Loading…</p>
      </Page>
    );
  }

  const gone = (id: string, message: string) => {
    setBatches((b) => (b ?? []).filter((x) => x.id !== id));
    setNotice(message);
  };

  return (
    <Page title="Trash" wide back={back}>
      <p>
        Deleted people and relationships stay here until you restore or erase them. Only you, the
        owner, can see this page.
      </p>
      {notice && <Success>{notice}</Success>}
      {batches.length === 0 ? (
        <EmptyState
          icon={<TrashIcon />}
          title="The Trash is empty."
          body="When someone is deleted from the tree, they wait here so you can bring them back."
        />
      ) : (
        <ul className="row-list trash-rows">
          {batches.map((b) => (
            <TrashRow key={b.id} treeId={treeId} batch={b} onGone={gone} />
          ))}
        </ul>
      )}
    </Page>
  );
}

function TrashRow({
  treeId,
  batch,
  onGone,
}: {
  treeId: string;
  batch: TrashBatch;
  onGone: (id: string, message: string) => void;
}) {
  const api = useTreesApi();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [detail, setDetail] = useState<TrashBatchDetail | null>(null);
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const detailsId = useId();

  async function toggle() {
    if (showing) return setShowing(false);
    setError(null);
    setLoading(true);
    const res = await api.getTrashBatch(treeId, batch.id);
    if (!alive.current) return;
    setLoading(false);
    if (!res.ok) return setError(res.error.message);
    setDetail(res.data);
    setShowing(true);
  }

  async function act(kind: 'restore' | 'erase') {
    setError(null);
    setPending(true);
    const res =
      kind === 'restore'
        ? await api.restoreBatch(treeId, batch.id)
        : await api.eraseBatch(treeId, batch.id);
    if (!alive.current) return;
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    onGone(batch.id, kind === 'restore' ? 'Restored.' : 'Erased.');
  }

  return (
    <li>
      <div className="row-main">
        <strong>{title(batch)}</strong>
        <span className="row-meta">
          Deleted {new Date(batch.createdAt).toLocaleString()} by{' '}
          {batch.deletedBy ?? 'a former member'}
          {counts(batch) && ` — ${counts(batch)}`}
        </span>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="link"
          disabled={loading}
          aria-expanded={showing}
          aria-controls={showing ? detailsId : undefined}
          onClick={() => void toggle()}
        >
          {showing ? 'Hide details' : 'Show details'}
        </button>
        <button
          type="button"
          className="compact"
          disabled={pending}
          onClick={() => void act('restore')}
        >
          Restore
        </button>
        <ConfirmButton
          label="Erase permanently"
          confirmLabel="Yes, erase for good"
          danger
          compact
          pending={pending}
          onConfirm={() => void act('erase')}
        />
      </div>
      {error && (
        <div className="row-details">
          <FormError>{error}</FormError>
        </div>
      )}
      {showing && detail && (
        <div className="row-details" id={detailsId}>
          <ul>
            {detail.people.map((p) => (
              <li key={p.id}>
                {personName(p)} {personYears(p)}
              </li>
            ))}
            {detail.unions.map((u) => (
              <li key={u.id}>
                {u.parentsUnknown && u.partners.length === 0
                  ? UNKNOWN_PARENTS
                  : join(u.partners, 'Relationship')}
              </li>
            ))}
            {detail.links.map((l) => (
              <li key={l.id}>
                {l.child ?? 'Someone'}, child of {join(l.parents, 'unknown parents')}
              </li>
            ))}
          </ul>
          {detail.slots > 0 && (
            <p>{plural(detail.slots, 'partner slot', 'partner slots')} to put back</p>
          )}
        </div>
      )}
    </li>
  );
}
