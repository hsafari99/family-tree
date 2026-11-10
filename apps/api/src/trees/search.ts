import { BIRTH_YEAR_SLACK, type ParsedSearchQuery, SEARCH_WORDS_MAX } from '@family-tree/shared';
import { and, asc, between, desc, eq, gte, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/client.js';
import { persons, photos, residences } from '../db/schema.js';
import { branchQuery } from './branch.js';
import { summaryColumns } from './people.js';

/** word_similarity thresholds (decisions 18, 19), set per query with set_config(…, true). */
const SEARCH_THRESHOLD = 0.4;
const SIMILAR_THRESHOLD = 0.3;
/** Words shorter than this are matched as prefixes, never as trigrams or substrings. */
const SHORT_WORD = 3;
/** Trigram candidates handed to findSimilar (decision 19). */
export const SIMILAR_CANDIDATES = 200;

/** The same normalisation as persons.search_name, so "Jose" meets "José". */
const norm = (s: string) => sql`lower(family_unaccent(${s}))`;
/** LIKE metacharacters in user input match literally (Postgres's default escape is \). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const threshold = (v: number) =>
  sql`select set_config('pg_trgm.word_similarity_threshold', ${String(v)}, true)`;

export const searchWords = (q: string | undefined) =>
  (q ?? '').split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS_MAX);

/** Live people matching every word and every filter, best first (decision 18). */
export function searchPersons(db: Db, treeId: string, q: ParsedSearchQuery) {
  const words = searchWords(q.q);
  const conds: (SQL | undefined)[] = [eq(persons.treeId, treeId), isNull(persons.deletedAt)];
  for (const w of words) {
    // One or two letters match trigrams of almost everything: only the start of the name or of a
    // word (after a space or a hyphen) counts, so "an" finds Anna and Mary Ann but not Hannah.
    conds.push(
      w.length < SHORT_WORD
        ? sql`(${persons.searchName} like ${norm(likeEscape(w))} || '%' or ${persons.searchName} like '% ' || ${norm(likeEscape(w))} || '%' or ${persons.searchName} like '%-' || ${norm(likeEscape(w))} || '%')`
        : sql`(${norm(w)} <% ${persons.searchName} or ${persons.searchName} like '%' || ${norm(likeEscape(w))} || '%')`,
    );
  }
  if (q.bornFrom !== undefined) conds.push(gte(persons.birthSortYear, q.bornFrom));
  if (q.bornTo !== undefined) conds.push(lte(persons.birthSortYear, q.bornTo));
  if (q.diedFrom !== undefined) conds.push(gte(persons.deathSortYear, q.diedFrom));
  if (q.diedTo !== undefined) conds.push(lte(persons.deathSortYear, q.diedTo));
  if (q.status) conds.push(eq(persons.isLiving, q.status === 'living'));
  if (q.place) {
    // Accent- and case-insensitive on both sides: "montreal" finds "Montréal".
    const pattern = sql`'%' || ${norm(likeEscape(q.place))} || '%'`;
    const matches = (col: AnyPgColumn) => sql`lower(family_unaccent(${col})) like ${pattern}`;
    conds.push(
      or(
        matches(persons.birthPlace),
        matches(persons.deathPlace),
        sql`exists (select 1 from ${residences} where ${residences.personId} = ${persons.id}
          and ${residences.deletedAt} is null and ${matches(residences.place)})`,
      ),
    );
  }
  // The spec §4 branch rule, as the full view's branch (no rule 5).
  if (q.branch) conds.push(sql`${persons.id} in (${branchQuery(treeId, q.branch, null)})`);
  // No words, no score: a bare constant in ORDER BY would be read as a column position.
  const score = words.length
    ? sql`(${sql.join(
        words.map((w) => sql`word_similarity(${norm(w)}, ${persons.searchName})`),
        sql` + `,
      )})`
    : null;
  return db.transaction(
    async (tx) => {
      await tx.execute(threshold(SEARCH_THRESHOLD));
      return tx
        .select({ ...summaryColumns, photoThumbKey: photos.storageKeyThumb })
        .from(persons)
        .leftJoin(photos, and(eq(photos.personId, persons.id), eq(photos.isPrimary, true)))
        .where(and(...conds))
        .orderBy(
          ...(score ? [desc(score)] : []),
          asc(persons.surname),
          asc(persons.givenName),
          asc(persons.id),
        )
        .limit(q.limit);
    },
    { accessMode: 'read only' },
  );
}

/** Trigram candidates for the duplicate check; findSimilar does the final rules (decision 19). */
export function similarCandidates(
  db: Db,
  treeId: string,
  q: { givenName: string; surname?: string | undefined; birthYear?: number | undefined },
) {
  const given = norm(q.givenName);
  // Given-name plus surname similarity, then the closest birth year, so the 200-row cap never
  // drops the best match in a tree full of one first name.
  const nameScore = q.surname
    ? sql`word_similarity(${given}, ${persons.searchName}) + word_similarity(${norm(q.surname)}, ${persons.searchName})`
    : sql`word_similarity(${given}, ${persons.searchName})`;
  const yearGap =
    q.birthYear === undefined
      ? sql`0::int`
      : sql`abs(${persons.birthSortYear} - ${q.birthYear}) nulls last`;
  return db.transaction(
    async (tx) => {
      await tx.execute(threshold(SIMILAR_THRESHOLD));
      return tx
        .select({ ...summaryColumns, maidenName: persons.maidenName, nickname: persons.nickname })
        .from(persons)
        .where(
          and(
            eq(persons.treeId, treeId),
            isNull(persons.deletedAt),
            sql`${given} <% ${persons.searchName}`,
            q.birthYear === undefined
              ? undefined
              : or(
                  isNull(persons.birthSortYear),
                  between(
                    persons.birthSortYear,
                    q.birthYear - BIRTH_YEAR_SLACK,
                    q.birthYear + BIRTH_YEAR_SLACK,
                  ),
                ),
          ),
        )
        .orderBy(desc(nameScore), yearGap, asc(persons.id))
        .limit(SIMILAR_CANDIDATES);
    },
    { accessMode: 'read only' },
  );
}
