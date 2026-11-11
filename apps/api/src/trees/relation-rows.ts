import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, unions } from '../db/schema.js';
import { notFound } from '../errors.js';

export type UnionRow = typeof unions.$inferSelect;
const present = (p: string | null): p is string => p !== null;

export async function requireLiveUnion(db: Queryable, treeId: string, unionId: string) {
  const [u] = await db
    .select()
    .from(unions)
    .where(and(eq(unions.treeId, treeId), eq(unions.id, unionId), isNull(unions.deletedAt)));
  if (!u) throw notFound();
  return { ...u, partners: [u.partnerAId, u.partnerBId].filter(present) };
}

/** A live link whose union and child are live too, with the union's partners. */
export async function requireLiveLink(db: Queryable, treeId: string, linkId: string) {
  const [row] = await db
    .select({ link: parentChild, partnerAId: unions.partnerAId, partnerBId: unions.partnerBId })
    .from(parentChild)
    .innerJoin(unions, and(eq(unions.id, parentChild.unionId), isNull(unions.deletedAt)))
    .innerJoin(persons, and(eq(persons.id, parentChild.childId), isNull(persons.deletedAt)))
    .where(
      and(
        eq(parentChild.treeId, treeId),
        eq(parentChild.id, linkId),
        isNull(parentChild.deletedAt),
      ),
    );
  if (!row) throw notFound();
  return { ...row.link, partners: [row.partnerAId, row.partnerBId].filter(present) };
}

export const UNION_EDIT_FIELDS = ['type', 'status', 'startDate', 'endDate'] as const;
export const unionFieldsOf = (u: UnionRow) => ({
  partnerAId: u.partnerAId,
  partnerBId: u.partnerBId,
  type: u.type,
  status: u.status,
  startDate: u.startDate,
  endDate: u.endDate,
  parentsUnknown: u.parentsUnknown,
});
