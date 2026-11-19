import type { LinkCandidate, TreeLink } from '@family-tree/shared';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmButton } from '../../components/ConfirmButton';
import { FormError, Success } from '../../components/forms';
import { countPeople } from '../../trees/format';
import { useTreesApi } from '../../trees/TreesApiContext';

/** What a link shares, said the same way wherever someone agrees to one. */
export const LINK_SUMMARY =
  'Members of both trees can see each other’s people, read-only, with each person’s privacy applied. Public details become visible across both trees.';

/**
 * The tree's links (tree linking spec, Web: Members dialog): live ones, pending requests the owner
 * accepts or declines, and "Link with another tree I'm in" for a member with a card elsewhere.
 */
export function LinkedTreesSection({
  treeId,
  onChanged,
}: {
  treeId: string;
  onChanged?: () => void;
}) {
  const api = useTreesApi();
  const [links, setLinks] = useState<TreeLink[] | null>(null);
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [l, c] = await Promise.all([api.listLinks(treeId), api.linkCandidates(treeId)]);
    if (l.ok) setLinks(l.data);
    else setError(l.error.message);
    if (c.ok) setCandidates(c.data);
  }, [api, treeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (
    run: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    message: string,
  ) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await run();
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setDone(message);
    await load();
    onChanged?.();
  };

  if (!links) return null;
  const live = links.filter((l) => l.status === 'live');
  const pending = links.filter((l) => l.status === 'pending');
  const picked = candidates.find((c) => c.treeId === choice) ?? null;

  return (
    <section aria-labelledby="linked-trees-title">
      <h2 id="linked-trees-title">Linked trees</h2>
      <FormError>{error}</FormError>
      {done && <Success>{done}</Success>}
      {live.length === 0 && pending.length === 0 && (
        <p>
          This tree isn’t linked to another tree. A member who has their own card in two trees can
          link them, and both owners agree.
        </p>
      )}
      {live.length > 0 && (
        <ul className="linked-trees">
          {live.map((l) => (
            <li key={l.id}>
              <strong>{l.otherTree.name}</strong> · through {l.bridge.name} ·{' '}
              {countPeople(l.otherPeopleCount)}{' '}
              {l.canEnd && (
                <ConfirmButton
                  label="End link"
                  confirmLabel={`End the link with ${l.otherTree.name}`}
                  danger
                  compact
                  pending={busy}
                  onConfirm={() =>
                    void act(
                      () => api.endLink(treeId, l.id),
                      `The link with ${l.otherTree.name} has ended. Neither tree sees the other now.`,
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && (
        <>
          <h3>Waiting</h3>
          <ul className="linked-trees">
            {pending.map((l) => (
              <li key={l.id}>
                {l.bridge.name} wants to link with <strong>{l.otherTree.name}</strong> (
                {countPeople(l.otherPeopleCount)}).{' '}
                {l.canAccept ? (
                  <>
                    <span className="hint">{LINK_SUMMARY}</span>{' '}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () => api.acceptLink(treeId, l.id),
                          l.acceptedThere
                            ? `Linked with ${l.otherTree.name}.`
                            : `Accepted. Waiting for the ${l.otherTree.name} owner.`,
                        )
                      }
                    >
                      Accept
                    </button>{' '}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api.declineLink(treeId, l.id), 'Request declined.')
                      }
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <>
                    <span className="hint">
                      {l.acceptedHere
                        ? `Waiting for the ${l.otherTree.name} owner.`
                        : 'Waiting for this tree’s owner.'}
                    </span>{' '}
                    {l.canEnd && (
                      <ConfirmButton
                        label="Cancel request"
                        confirmLabel="Cancel the request"
                        compact
                        pending={busy}
                        onConfirm={() =>
                          void act(() => api.endLink(treeId, l.id), 'Request cancelled.')
                        }
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {candidates.length > 0 && !proposing && (
        <p>
          <button type="button" className="secondary" onClick={() => setProposing(true)}>
            Link with another tree I’m in
          </button>
        </p>
      )}
      {proposing && (
        <form
          className="link-propose"
          onSubmit={(e) => {
            e.preventDefault();
            if (!picked) return;
            void act(
              () => api.proposeLink(treeId, picked.treeId),
              `Request sent. The owners of both trees need to accept.`,
            ).then(() => {
              setProposing(false);
              setChoice('');
            });
          }}
        >
          <label>
            Tree to link with{' '}
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose a tree</option>
              {candidates.map((c) => (
                <option key={c.treeId} value={c.treeId}>
                  {c.name} ({countPeople(c.peopleCount)})
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            The link goes through your own card, which is in both trees. {LINK_SUMMARY}
          </p>
          <button type="submit" disabled={!picked || busy}>
            Send request
          </button>{' '}
          <button type="button" className="secondary" onClick={() => setProposing(false)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
