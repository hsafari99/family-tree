import {
  type FuzzyDate,
  PERSON_FIELDS,
  type PersonDetail,
  type PersonField,
  sortYear,
} from '@family-tree/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '../db/client.js';
import { persons } from '../db/schema.js';
import { notFound } from '../errors.js';

export type PersonRow = typeof persons.$inferSelect;

/** The columns of a PersonSummary (same shape as GET /persons). */
export const summaryColumns = {
  id: persons.id,
  givenName: persons.givenName,
  middleName: persons.middleName,
  surname: persons.surname,
  birthYear: persons.birthSortYear,
  deathYear: persons.deathSortYear,
  isLiving: persons.isLiving,
};

export const isLivePerson = (treeId: string, personId: string) =>
  and(eq(persons.treeId, treeId), eq(persons.id, personId), isNull(persons.deletedAt));

/** A live person of this tree, or 404. */
export async function requireLivePerson(
  db: Queryable,
  treeId: string,
  personId: string,
): Promise<PersonRow> {
  const [row] = await db.select().from(persons).where(isLivePerson(treeId, personId));
  if (!row) throw notFound();
  return row;
}

/** Column values for the given fields plus the derived sort years; undefined fields are skipped. */
export function personColumns(
  input: Partial<Record<PersonField, unknown>>,
): Partial<typeof persons.$inferInsert> {
  const cols: Record<string, unknown> = {};
  for (const k of PERSON_FIELDS) if (input[k] !== undefined) cols[k] = input[k];
  const birth = input.birthDate as FuzzyDate | null | undefined;
  const death = input.deathDate as FuzzyDate | null | undefined;
  if (birth !== undefined) cols.birthSortYear = birth ? sortYear(birth) : null;
  if (death !== undefined) cols.deathSortYear = death ? sortYear(death) : null;
  return cols as Partial<typeof persons.$inferInsert>;
}

export function personFieldsOf(row: PersonRow): Pick<PersonRow, PersonField> {
  return Object.fromEntries(PERSON_FIELDS.map((k) => [k, row[k]])) as Pick<PersonRow, PersonField>;
}

export function toPersonDetail(row: PersonRow, createdByName: string | null): PersonDetail {
  return {
    id: row.id,
    ...personFieldsOf(row),
    version: row.version,
    createdByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Display name for Trash labels ("Ada King Lovelace"). Data, not interface text. */
export const fullName = (p: {
  givenName: string;
  middleName: string | null;
  surname: string | null;
}) => [p.givenName, p.middleName, p.surname].filter(Boolean).join(' ');
