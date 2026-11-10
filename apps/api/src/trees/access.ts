import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { branchStewards, treeMembers, trees, users } from '../db/schema.js';
import { forbidden, notFound } from '../errors.js';
import {
  type Action,
  type Actor,
  can,
  type Grant,
  inScope,
  type Targets,
} from '../permissions/can.js';
import { branchPersonIds } from './branch.js';

export interface Access extends Actor {
  treeId: string;
  treeName: string;
  rootPersonId: string | null;
  personId: string | null;
  twoFactorEnabled: boolean;
  /** Grants held, including ones not yet effective because 2FA is off. */
  heldGrants: { id: string; anchorPersonId: string }[];
  deletedAt: Date | null;
}

/**
 * The user's access to a tree, or a 404 if they aren't a member or the tree is deleted (pass
 * includeDeleted for the restore route). Steward scopes are computed here: each grant's scope is
 * branch(anchor, grantee) intersected with every ancestor grant's branch (spec §4).
 */
export async function loadAccess(
  db: Queryable,
  treeId: string,
  userId: string,
  { includeDeleted = false } = {},
): Promise<Access> {
  const [row] = await db
    .select({
      treeName: trees.name,
      rootPersonId: trees.rootPersonId,
      deletedAt: trees.deletedAt,
      role: treeMembers.role,
      personId: treeMembers.personId,
      twoFactorEnabled: users.twoFactorEnabled,
    })
    .from(treeMembers)
    .innerJoin(trees, eq(trees.id, treeMembers.treeId))
    .innerJoin(users, eq(users.id, treeMembers.userId))
    .where(
      and(
        eq(treeMembers.treeId, treeId),
        eq(treeMembers.userId, userId),
        includeDeleted ? undefined : isNull(trees.deletedAt),
      ),
    );
  if (!row) throw notFound();

  const held =
    row.role === 'owner'
      ? []
      : await db
          .select({ id: branchStewards.id, anchorPersonId: branchStewards.anchorPersonId })
          .from(branchStewards)
          .where(and(eq(branchStewards.treeId, treeId), eq(branchStewards.userId, userId)));

  const grants: Grant[] = [];
  if (row.twoFactorEnabled && row.deletedAt === null) {
    const branches = new Map<string, Promise<Set<string>>>();
    const branch = (anchor: string, user: string) => {
      const key = `${anchor}:${user}`;
      let p = branches.get(key);
      if (!p) branches.set(key, (p = branchPersonIds(db, treeId, anchor, user)));
      return p;
    };
    // One query for every chain. UNION (not UNION ALL) makes a looping parent chain terminate;
    // the walk below then treats any cycle as invalid. The join stays inside this tree.
    const rows = (await db.execute(sql`
      with recursive chain as (
        select id as root_id, id, user_id, anchor_person_id, parent_grant_id
        from branch_stewards where tree_id = ${treeId} and user_id = ${userId}
        union
        select c.root_id, b.id, b.user_id, b.anchor_person_id, b.parent_grant_id
        from branch_stewards b join chain c on b.id = c.parent_grant_id
        where b.tree_id = ${treeId}
      )
      select root_id, id, user_id, anchor_person_id, parent_grant_id from chain
    `)) as unknown as {
      root_id: string;
      id: string;
      user_id: string;
      anchor_person_id: string;
      parent_grant_id: string | null;
    }[];
    const byRoot = new Map<string, Map<string, (typeof rows)[number]>>();
    for (const r of rows) {
      let m = byRoot.get(r.root_id);
      if (!m) byRoot.set(r.root_id, (m = new Map()));
      m.set(r.id, r);
    }
    for (const g of held) {
      const links = byRoot.get(g.id);
      const seen = new Set<string>();
      let scope: Set<string> | undefined;
      let cyclic = false;
      for (
        let link = links?.get(g.id);
        link;
        link = link.parent_grant_id ? links?.get(link.parent_grant_id) : undefined
      ) {
        if (seen.has(link.id)) {
          cyclic = true;
          break;
        }
        seen.add(link.id);
        const b = await branch(link.anchor_person_id, link.user_id);
        scope = scope ? new Set([...scope].filter((id) => b.has(id))) : b;
      }
      // A cyclic chain is corrupt data: that grant confers nothing.
      if (!cyclic && scope) grants.push({ id: g.id, anchorPersonId: g.anchorPersonId, scope });
    }
  }

  return {
    userId,
    treeId,
    treeName: row.treeName,
    rootPersonId: row.rootPersonId,
    personId: row.personId,
    role: row.role,
    twoFactorEnabled: row.twoFactorEnabled,
    heldGrants: held,
    grants,
    deletedAt: row.deletedAt,
  };
}

/** Throws FORBIDDEN unless can() allows it. */
export function authorize<A extends Action>(access: Access, action: A, target: Targets[A]) {
  if (!can(access, action, target)) throw forbidden();
}

/** The actor's grant whose scope covers `personId`: the parent for a grant they make. */
export function grantCovering(actor: Actor, personId: string): Grant | undefined {
  return actor.grants.find((g) => g.scope.has(personId));
}

export { inScope };
