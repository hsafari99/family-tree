import {
  type Birthday,
  type FuzzyDate,
  type PersonDetail,
  type PersonSummary,
  stepDistances,
} from '@family-tree/shared';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { parentChild, persons, treeMembers, unions } from '../db/schema.js';
import { inScope } from '../permissions/can.js';
import type { Access } from './access.js';

/**
 * What one viewer may see of each person (privacy spec). `full` false: only the names (R2).
 * `birthYear` false: the birth year is hidden too (D8, R3).
 */
export interface Visibility {
  full(personId: string): boolean;
  birthYear(personId: string): boolean;
  /** False when nothing is hidden from this viewer, so callers can skip masking. */
  readonly restricts: boolean;
}

export const SEES_ALL: Visibility = { full: () => true, birthYear: () => true, restricts: false };

type Graph = {
  unions: readonly { id: string; partnerAId: string | null; partnerBId: string | null }[];
  parentChild: readonly { id: string; unionId: string; childId: string }[];
};

/**
 * The viewer's visibility in their tree. Owners and editors see everything (D7); so does a
 * steward for the people in their scope, and everyone for themselves (R1). Settings count only
 * while a member is linked to the person (D3). Pass the live graph when the caller has it.
 */
export async function loadVisibility(
  db: Queryable,
  access: Access,
  graph?: Graph,
): Promise<Visibility> {
  if (access.role === 'owner' || access.role === 'editor') return SEES_ALL;
  const rows = await db
    .select({
      id: persons.id,
      level: persons.privacyLevel,
      steps: persons.privacySteps,
      hideBirthYear: persons.hideBirthYear,
    })
    .from(persons)
    .innerJoin(
      treeMembers,
      and(eq(treeMembers.treeId, persons.treeId), eq(treeMembers.personId, persons.id)),
    )
    .where(
      and(
        eq(persons.treeId, access.treeId),
        isNull(persons.deletedAt),
        or(ne(persons.privacyLevel, 'public'), eq(persons.hideBirthYear, true)),
      ),
    );
  const exempt = (id: string) => id === access.personId || inScope(access, id);
  const settings = new Map(rows.filter((r) => !exempt(r.id)).map((r) => [r.id, r]));
  if (settings.size === 0) return SEES_ALL;

  let dist = new Map<string, number>();
  const reach = Math.max(0, ...[...settings.values()].map((r) => r.steps ?? 0));
  if (reach > 0 && access.personId !== null) {
    dist = stepDistances(graph ?? (await loadLiveLinks(db, access.treeId)), access.personId, reach);
  }
  const full = (id: string) => {
    const s = settings.get(id);
    if (!s || s.level === 'public') return true;
    if (s.level === 'private') return false;
    // D6: a member with no linked person is never within reach.
    const d = dist.get(id);
    return d !== undefined && d <= (s.steps ?? 0);
  };
  return {
    full,
    birthYear: (id) => full(id) && !settings.get(id)?.hideBirthYear,
    restricts: true,
  };
}

/** Live unions and links, enough to count steps. */
async function loadLiveLinks(db: Queryable, treeId: string): Promise<Graph> {
  const live = new Set(
    (
      await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.treeId, treeId), isNull(persons.deletedAt)))
    ).map((p) => p.id),
  );
  const liveOrNull = (id: string | null) => (id !== null && live.has(id) ? id : null);
  const us = (
    await db
      .select({ id: unions.id, partnerAId: unions.partnerAId, partnerBId: unions.partnerBId })
      .from(unions)
      .where(and(eq(unions.treeId, treeId), isNull(unions.deletedAt)))
  ).map((u) => ({
    ...u,
    partnerAId: liveOrNull(u.partnerAId),
    partnerBId: liveOrNull(u.partnerBId),
  }));
  const links = await db
    .select({ id: parentChild.id, unionId: parentChild.unionId, childId: parentChild.childId })
    .from(parentChild)
    .where(and(eq(parentChild.treeId, treeId), isNull(parentChild.deletedAt)));
  return { unions: us, parentChild: links.filter((l) => live.has(l.childId)) };
}

/** A summary-shaped row as this viewer may see it (R2, R3). Extra columns pass through. */
export function maskSummary<T extends PersonSummary>(p: T, vis: Visibility): T {
  if (!vis.restricts) return p;
  if (!vis.full(p.id))
    return { ...p, birthYear: null, deathYear: null, isLiving: true, restricted: true };
  if (!vis.birthYear(p.id)) return { ...p, birthYear: null };
  return p;
}

/** Graph rows also carry sex and a photo (R2: a neutral outline, no picture). */
export function maskGraphPerson<
  T extends PersonSummary & { sex: string; photoThumbKey: string | null },
>(p: T, vis: Visibility): T {
  const m = maskSummary(p, vis);
  return m.restricted ? { ...m, sex: 'unknown', photoThumbKey: null } : m;
}

/** A union's dates are hidden when either partner is hidden (R4). */
export function unionDatesVisible(
  u: { partnerAId: string | null; partnerBId: string | null },
  vis: Visibility,
): boolean {
  return [u.partnerAId, u.partnerBId].every((p) => p === null || vis.full(p));
}

export function birthdayOf(date: FuzzyDate | null): Birthday | null {
  if (!date || date.qualifier !== 'exact') return null;
  const [, month, day] = date.date1.split('-').map(Number);
  return month === undefined ? null : { month, day: day ?? null };
}

/** The person panel's record for this viewer (R2, D8). */
export function maskDetail(d: PersonDetail, vis: Visibility): PersonDetail {
  if (!vis.restricts) return d;
  if (!vis.full(d.id)) {
    return {
      ...d,
      sex: 'unknown',
      birthDate: null,
      birthPlace: null,
      deathDate: null,
      deathPlace: null,
      causeOfDeath: null,
      isLiving: true,
      occupation: null,
      education: null,
      biography: null,
      notes: null,
      createdByName: null,
      restricted: true,
    };
  }
  if (!vis.birthYear(d.id)) return { ...d, birthDate: null, birthday: birthdayOf(d.birthDate) };
  return d;
}

/** Graph rows as this viewer may see them: people (R2, R3) and union dates (R4). */
export function maskGraphRows<
  R extends {
    persons: (PersonSummary & { sex: string; photoThumbKey: string | null })[];
    unions: {
      partnerAId: string | null;
      partnerBId: string | null;
      startDate: FuzzyDate | null;
      endDate: FuzzyDate | null;
    }[];
  },
>(rows: R, vis: Visibility): R {
  if (!vis.restricts) return rows;
  return {
    ...rows,
    persons: rows.persons.map((p) => maskGraphPerson(p, vis)),
    unions: rows.unions.map((u) =>
      unionDatesVisible(u, vis) ? u : { ...u, startDate: null, endDate: null },
    ),
  };
}
