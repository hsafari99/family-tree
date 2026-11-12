import type { Invite, Member, PersonSummary, StewardGrant, TreeDetail } from '@family-tree/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { FormError } from '../components/forms';
import { Page } from '../components/Page';
import { useTreesApi } from '../trees/TreesApiContext';
import { InvitesSection } from './members/InvitesSection';
import { MembersSection } from './members/MembersSection';
import { StewardsSection } from './members/StewardsSection';
import type { Acted, Part } from './members/types';

export function MembersPage() {
  const { treeId = '' } = useParams();
  const api = useTreesApi();
  const { user } = useAuth();
  const [detail, setDetail] = useState<TreeDetail | null>(null);
  const [persons, setPersons] = useState<PersonSummary[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [stewards, setStewards] = useState<StewardGrant[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acted, setActed] = useState<Acted>({ n: 0, from: null });
  const onActed = useCallback((from: Acted['from']) => setActed((a) => ({ n: a.n + 1, from })), []);
  // The tree this page is showing now; late responses for another tree are dropped.
  const current = useRef(treeId);

  const reload = useCallback(
    async (...parts: Part[]) => {
      let wantsInvites = true;
      const failures: string[] = [];
      const stale = () => current.current !== treeId;
      const take = <T,>(
        res: { ok: true; data: T } | { ok: false; error: { message: string } },
        set: (v: T) => void,
      ) => {
        if (stale()) return;
        if (res.ok) set(res.data);
        else failures.push(res.error.message);
      };

      if (parts.includes('tree')) {
        const res = await api.getTree(treeId);
        take(res, (v) => {
          wantsInvites = v.capabilities.invite || v.capabilities.manageTree;
          setDetail(v);
        });
      }
      await Promise.all([
        parts.includes('persons') && api.listPersons(treeId).then((r) => take(r, setPersons)),
        parts.includes('members') && api.listMembers(treeId).then((r) => take(r, setMembers)),
        parts.includes('stewards') && api.listStewards(treeId).then((r) => take(r, setStewards)),
        // After a transfer the viewer may no longer be allowed to list invites.
        parts.includes('invites') &&
          wantsInvites &&
          api.listInvites(treeId).then((r) => take(r, setInvites)),
      ]);
      if (stale()) return;
      // A successful reload means whatever failed before has recovered.
      setError(failures[0] ?? null);
    },
    [api, treeId],
  );

  useEffect(() => {
    let active = true;
    current.current = treeId;
    setDetail(null);
    setPersons([]);
    setMembers([]);
    setStewards([]);
    setInvites([]);
    setError(null);
    void (async () => {
      const t = await api.getTree(treeId);
      if (!active) return;
      if (!t.ok) return setError(t.error.message);
      setDetail(t.data);
      const wantsInvites = t.data.capabilities.invite || t.data.capabilities.manageTree;
      await reload(
        'persons',
        'members',
        'stewards',
        ...(wantsInvites ? (['invites'] as const) : []),
      );
    })();
    return () => {
      active = false;
    };
  }, [api, treeId, reload]);

  if (!detail || !user || user === 'loading') {
    return (
      <Page title="Members" wide>
        <FormError>{error}</FormError>
        {!error && <p>Loading…</p>}
        {error && (
          <p>
            <Link to="/">Back to your trees</Link>
          </p>
        )}
      </Page>
    );
  }

  const props = {
    treeId,
    detail,
    persons,
    members,
    stewards,
    me: user.id,
    reload,
    acted,
    onActed,
  };
  return (
    <Page title={`Members of ${detail.tree.name}`} wide>
      <FormError>{error}</FormError>
      <MembersSection {...props} />
      <StewardsSection {...props} />
      {detail.capabilities.invite && <InvitesSection {...props} invites={invites} />}
      <p>
        <Link to={`/trees/${treeId}`}>Back to the tree</Link>
      </p>
    </Page>
  );
}
