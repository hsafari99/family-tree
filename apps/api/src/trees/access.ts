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
    for (const g of held) {
      const chain = (await db.execute(sql`
        with recursive chain as (
          select id, user_id, anchor_person_id, parent_grant_id from branch_stewards where id = ${g.id}
          union all
          select b.id, b.user_id, b.anchor_person_id, b.parent_grant_id
          from branch_stewards b join chain c on b.id = c.parent_grant_id
        )
        select user_id, anchor_person_id from chain
      `)) as unknown as { user_id: string; anchor_person_id: string }[];
      let scope: Set<string> | undefined;
      for (const link of chain) {
        const b = await branch(link.anchor_person_id, link.user_id);
        scope = scope ? new Set([...scope].filter((id) => b.has(id))) : b;
      }
      grants.push({ id: g.id, anchorPersonId: g.anchorPersonId, scope: scope ?? new Set() });
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
