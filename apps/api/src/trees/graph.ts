import type { LiveGraph } from '@family-tree/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';

/**
 * The tree's live skeleton (ids only), for the planners in packages/shared. A partner that isn't
 * live reads as an empty slot; a union with no live partner, and links whose union or child
 * isn't live, are left out. Fine for family-sized trees (one row per person/union/link).
 */
export async function loadLiveGraph(db: Queryable, treeId: string): Promise<LiveGraph> {
  const people = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)));
  const live = new Set(people.map((p) => p.id));
  const liveOrNull = (id: string | null) => (id !== null && live.has(id) ? id : null);
  const rawUnions = await db
    .select({ id: unions.id, partnerAId: unions.partnerAId, partnerBId: unions.partnerBId })
    .from(unions)
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)));
  const liveUnions = rawUnions
    .map((u) => ({
      id: u.id,
      partnerAId: liveOrNull(u.partnerAId),
      partnerBId: liveOrNull(u.partnerBId),
    }))
    .filter((u) => u.partnerAId !== null || u.partnerBId !== null);
  const unionIds = new Set(liveUnions.map((u) => u.id));
  const links = await db
    .select({ id: parentChild.id, unionId: parentChild.unionId, childId: parentChild.childId })
    .from(parentChild)
    .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)));
  return {
    persons: people,
    unions: liveUnions,
    parentChild: links.filter((l) => unionIds.has(l.unionId) && live.has(l.childId)),
  };
}

/** Serialises structural changes to one tree (decision 10). Call first inside the transaction. */
export const lockTreeGraph = (db: Queryable, treeId: string) =>
  db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`graph:${treeId}`}, 0))`);
