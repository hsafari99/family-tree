import {
  compareSiblings,
  type FuzzyDate,
  type PersonSummary,
  type PersonView,
  sortYear,
} from '@family-tree/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, residences, unions, users } from '../db/schema.js';
import { notFound } from '../errors.js';
import { loadPhotos, photoUsage } from '../photos/photos.js';
import type { ObjectStore } from '../storage/objects.js';
import { can } from '../permissions/can.js';
import type { Access } from './access.js';
import { isLivePerson, summaryColumns, toPersonDetail } from './people.js';

type OrderedUnion = {
  id: string;
  partnerAId: string | null;
  partnerAOrder: number | null;
  partnerBOrder: number | null;
  startDate: FuzzyDate | null;
  createdAt?: Date;
};
/**
 * A person's unions in their own order (brief #16): their slot's saved order (nulls last), then
 * start year (undated last), then creation, then id. `Infinity - Infinity` is NaN, which is falsy, so two nulls
 * fall through to the next key.
 */
export const byOwnOrder = (personId: string) => (x: OrderedUnion, y: OrderedUnion) => {
  const own = (u: OrderedUnion) =>
    (u.partnerAId === personId ? u.partnerAOrder : u.partnerBOrder) ?? Infinity;
  const year = (u: OrderedUnion) => (u.startDate ? sortYear(u.startDate) : Infinity);
  const made = (u: OrderedUnion) => u.createdAt?.getTime() ?? 0;
  return (
    own(x) - own(y) ||
    year(x) - year(y) ||
    made(x) - made(y) ||
    (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)
  );
};

/** Everything the person panel shows. Relations only use live unions, links and people. */
export async function loadPersonView(
  db: Queryable,
  access: Access,
  personId: string,
  store: ObjectStore,
  limitBytes: number,
): Promise<PersonView> {
  const { treeId } = access;
  const [row] = await db
    .select({ p: persons, createdByName: users.name })
    .from(persons)
    .leftJoin(users, eq(users.id, persons.createdBy))
    .where(isLivePerson(treeId, personId));
  if (!row) throw notFound();

  const homes = await db
    .select({
      id: residences.id,
      place: residences.place,
      fromDate: residences.fromDate,
      toDate: residences.toDate,
    })
    .from(residences)
    .where(
      and(
        eq(residences.treeId, treeId),
        eq(residences.personId, personId),
        isNull(residences.deletedAt),
      ),
    )
    .orderBy(asc(residences.createdAt));

  const order = new Map<string, number | null>();
  const people = new Map<string, PersonSummary>();
  for (const { siblingOrder, ...summary } of await db
    .select({ ...summaryColumns, siblingOrder: persons.siblingOrder })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)))) {
    people.set(summary.id, summary);
    order.set(summary.id, siblingOrder);
  }
  const bySibling = <T extends { childId: string }>(a: T, b: T) =>
    compareSiblings(
      { ...people.get(a.childId)!, siblingOrder: order.get(a.childId) ?? null },
      { ...people.get(b.childId)!, siblingOrder: order.get(b.childId) ?? null },
    );
  const liveUnions = await db
    .select({
      id: unions.id,
      partnerAId: unions.partnerAId,
      partnerBId: unions.partnerBId,
      type: unions.type,
      status: unions.status,
      startDate: unions.startDate,
      endDate: unions.endDate,
      parentsUnknown: unions.parentsUnknown,
      partnerAOrder: unions.partnerAOrder,
      partnerBOrder: unions.partnerBOrder,
      createdAt: unions.createdAt,
    })
    .from(unions)
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)));
  const unionById = new Map(liveUnions.map((u) => [u.id, u]));
  const links = (
    await db
      .select({
        id: parentChild.id,
        unionId: parentChild.unionId,
        childId: parentChild.childId,
        kind: parentChild.kind,
      })
      .from(parentChild)
      .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)))
  ).filter((l) => unionById.has(l.unionId) && people.has(l.childId));

  const summary = (id: string | null) => (id === null ? null : (people.get(id) ?? null));
  const partnerSummaries = (u: { partnerAId: string | null; partnerBId: string | null }) =>
    [u.partnerAId, u.partnerBId].map(summary).filter((p): p is PersonSummary => p !== null);

  const livePartners = (u: { partnerAId: string | null; partnerBId: string | null }) =>
    [u.partnerAId, u.partnerBId].filter((p): p is string => p !== null && people.has(p));
  const childOf = new Set(links.filter((l) => l.childId === personId).map((l) => l.unionId));
  /** Unions sharing a live partner with `u` that the person could move to (brief #13). */
  const moveTo = (u: { id: string; partnerAId: string | null; partnerBId: string | null }) => {
    const mine = livePartners(u);
    return liveUnions
      .filter((x) => x.id !== u.id && !childOf.has(x.id))
      .filter((x) => !livePartners(x).includes(personId))
      .filter((x) => livePartners(x).some((p) => mine.includes(p)))
      .map((x) => ({ unionId: x.id, parents: partnerSummaries(x) }));
  };
  const parents = links
    .filter((l) => l.childId === personId)
    .map((l) => {
      const u = unionById.get(l.unionId)!;
      return {
        linkId: l.id,
        kind: l.kind,
        union: { id: u.id, type: u.type, status: u.status },
        parents: partnerSummaries(u),
        moveTo: moveTo(u),
      };
    });
  const parentUnionIds = new Set(parents.map((p) => p.union.id));
  const siblings = links
    .filter((l) => parentUnionIds.has(l.unionId) && l.childId !== personId)
    .sort(bySibling)
    .map((l) => ({ unionId: l.unionId, kind: l.kind, person: people.get(l.childId)! }));
  const own = liveUnions
    .filter((u) => u.partnerAId === personId || u.partnerBId === personId)
    .sort(byOwnOrder(personId))
    .map((u) => ({
      id: u.id,
      type: u.type,
      status: u.status,
      startDate: u.startDate,
      endDate: u.endDate,
      partner: summary(u.partnerAId === personId ? u.partnerBId : u.partnerAId),
      children: links
        .filter((l) => l.unionId === u.id)
        .sort(bySibling)
        .map((l) => ({ linkId: l.id, kind: l.kind, person: people.get(l.childId)! })),
    }));

  return {
    person: toPersonDetail(row.p, row.createdByName),
    residences: homes,
    photos: await loadPhotos(db, store, treeId, personId),
    photoUsage: await photoUsage(db, treeId, limitBytes),
    relations: { parents, unions: own, siblings },
    capabilities: {
      edit: can(access, 'person.edit', { kind: 'person', personId }),
      addRelative: can(access, 'person.add', { kind: 'relation', ends: [personId] }),
      delete: can(access, 'person.delete', { kind: 'people', personIds: [personId] }),
    },
  };
}
