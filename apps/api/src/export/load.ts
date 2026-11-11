import { EXPORT_FORMAT, EXPORT_VERSION, type ExportData } from '@family-tree/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, photos, residences, trees, unions } from '../db/schema.js';

export interface LoadedExport {
  /** Every photo has `file: null` here; writeExport fills in the ones it wrote. */
  data: ExportData;
  /** Photo id → storage key of the full version. Never written into the export. */
  photoKeys: Map<string, string>;
  /** Stored bytes (full + thumbnail) of the exported photos: an upper bound for the ZIP. */
  photoBytes: number;
}

/**
 * The live tree in a stable order (created_at, id), with the same "live" rules as the graph: a
 * partner who isn't live is an empty slot, a union with no live partner is left out (unless it is a parents-unknown union), and so are
 * links, residences and photos of people who aren't live. Call inside one snapshot transaction
 * after the access check (decision 4).
 */
export async function loadExport(db: Queryable, treeId: string, now: Date): Promise<LoadedExport> {
  const [tree] = await db
    .select({ id: trees.id, name: trees.name, rootPersonId: trees.rootPersonId })
    .from(trees)
    .where(eq(trees.id, treeId));
  if (!tree) throw new Error('loadExport: the tree vanished inside the snapshot');

  const people = await db
    .select({
      id: persons.id,
      givenName: persons.givenName,
      middleName: persons.middleName,
      surname: persons.surname,
      maidenName: persons.maidenName,
      nickname: persons.nickname,
      sex: persons.sex,
      birthDate: persons.birthDate,
      birthPlace: persons.birthPlace,
      deathDate: persons.deathDate,
      deathPlace: persons.deathPlace,
      causeOfDeath: persons.causeOfDeath,
      isLiving: persons.isLiving,
      occupation: persons.occupation,
      education: persons.education,
      biography: persons.biography,
      notes: persons.notes,
      siblingOrder: persons.siblingOrder,
    })
    .from(persons)
    .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)))
    .orderBy(asc(persons.createdAt), asc(persons.id));
  const live = new Set(people.map((p) => p.id));
  const liveOrNull = (pid: string | null) => (pid !== null && live.has(pid) ? pid : null);

  const unionRows = await db
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
    })
    .from(unions)
    .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)))
    .orderBy(asc(unions.createdAt), asc(unions.id));
  const liveUnions = unionRows
    .map((u) => ({
      ...u,
      partnerAId: liveOrNull(u.partnerAId),
      partnerBId: liveOrNull(u.partnerBId),
    }))
    .filter((u) => u.partnerAId !== null || u.partnerBId !== null || u.parentsUnknown);
  const unionIds = new Set(liveUnions.map((u) => u.id));

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
      .orderBy(asc(parentChild.createdAt), asc(parentChild.id))
  ).filter((l) => unionIds.has(l.unionId) && live.has(l.childId));

  const places = (
    await db
      .select({
        id: residences.id,
        personId: residences.personId,
        place: residences.place,
        fromDate: residences.fromDate,
        toDate: residences.toDate,
      })
      .from(residences)
      .where(eq(residences.treeId, treeId))
      .orderBy(asc(residences.createdAt), asc(residences.id))
  ).filter((r) => live.has(r.personId));

  // Primary photos first, then oldest: per person that numbers the primary 1 (decision 2).
  const photoRows = (
    await db
      .select({
        id: photos.id,
        personId: photos.personId,
        key: photos.storageKeyFull,
        width: photos.width,
        height: photos.height,
        isPrimary: photos.isPrimary,
        bytes: photos.bytes,
      })
      .from(photos)
      .where(eq(photos.treeId, treeId))
      .orderBy(desc(photos.isPrimary), asc(photos.createdAt), asc(photos.id))
  ).filter((p) => live.has(p.personId));

  return {
    data: {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      tree: { ...tree, rootPersonId: liveOrNull(tree.rootPersonId) },
      persons: people,
      unions: liveUnions,
      parentChild: links,
      residences: places,
      photos: photoRows.map((p) => ({
        id: p.id,
        personId: p.personId,
        file: null,
        width: p.width,
        height: p.height,
        isPrimary: p.isPrimary,
      })),
    },
    photoKeys: new Map(photoRows.map((p) => [p.id, p.key])),
    photoBytes: photoRows.reduce((n, p) => n + p.bytes, 0),
  };
}
