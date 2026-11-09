import { sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';

/**
 * Person ids in the branch of `anchorId` (spec §4), live rows only. Twin of branchOf() in
 * packages/shared; both are tested against BRANCH_CASES.
 *  1–3: the anchor's ancestors and all their descendants, via live parent_child links of live
 *       unions (any kind: biological, adoptive, step, foster);
 *  4:   partners (in live unions) of those people, unless the partner has parents recorded;
 *  5:   live people the steward created.
 * UNION (not UNION ALL) in the recursive parts makes cycles in bad data terminate.
 */
export function branchQuery(treeId: string, anchorId: string, stewardUserId: string | null) {
  return sql`
    with recursive
      parent_edges as (
        select pc.child_id, p.parent_id
        from parent_child pc
        join unions u on u.id = pc.union_id and u.deleted_at is null
        cross join lateral (values (u.partner_a_id), (u.partner_b_id)) as p(parent_id)
        where pc.tree_id = ${treeId} and pc.deleted_at is null and p.parent_id is not null
      ),
      ancestors(id) as (
        select ${anchorId}::uuid
        union
        select pe.parent_id from parent_edges pe join ancestors a on pe.child_id = a.id
      ),
      descendants(id) as (
        select id from ancestors
        union
        select pe.child_id from parent_edges pe join descendants d on pe.parent_id = d.id
      ),
      core as (
        select p.id from persons p join descendants d on d.id = p.id
        where p.tree_id = ${treeId} and p.deleted_at is null
      ),
      partners as (
        select case when u.partner_a_id = c.id then u.partner_b_id else u.partner_a_id end as id
        from unions u join core c on c.id in (u.partner_a_id, u.partner_b_id)
        where u.tree_id = ${treeId} and u.deleted_at is null
      )
    select id from core
    union
    select pt.id from partners pt
      join persons p on p.id = pt.id and p.tree_id = ${treeId} and p.deleted_at is null
      where not exists (select 1 from parent_edges pe where pe.child_id = pt.id)
    union
    select p.id from persons p
      where p.tree_id = ${treeId} and p.deleted_at is null
        and ${stewardUserId}::uuid is not null and p.created_by = ${stewardUserId}::uuid
  `;
}

export async function branchPersonIds(
  db: Queryable,
  treeId: string,
  anchorId: string,
  stewardUserId: string | null,
): Promise<Set<string>> {
  const rows = (await db.execute(branchQuery(treeId, anchorId, stewardUserId))) as unknown as {
    id: string;
  }[];
  return new Set(rows.map((r) => r.id));
}
