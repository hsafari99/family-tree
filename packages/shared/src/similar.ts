/** Phase 5 duplicate check (decision 8). Phase 6 replaces the candidate search with pg_trgm. */

export interface SimilarCandidate {
  id: string;
  givenName: string;
  middleName: string | null;
  surname: string | null;
  maidenName: string | null;
  nickname: string | null;
  birthYear: number | null;
  deathYear: number | null;
  isLiving: boolean;
}
export interface SimilarInput {
  givenName: string;
  surname?: string | undefined;
  birthYear?: number | undefined;
}
export const BIRTH_YEAR_SLACK = 2;

export function normalizeName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance, or `limit + 1` as soon as it is certainly above `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      row.push(v);
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return Math.min(prev[b.length]!, limit + 1);
}

function close(a: string, b: string): boolean {
  if (a === '' || b === '') return false;
  if (a === b) return true;
  const short = Math.min(a.length, b.length);
  if (short >= 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  const allowed = short >= 7 ? 2 : short >= 4 ? 1 : 0;
  return allowed > 0 && editDistance(a, b, allowed) <= allowed;
}

const names = (...xs: (string | null)[]) =>
  xs.filter((x): x is string => x !== null && x.trim() !== '').map(normalizeName);

/** The best `limit` candidates that could be the person being added, best first. */
export function findSimilar<T extends SimilarCandidate>(
  candidates: readonly T[],
  q: SimilarInput,
  limit: number,
): T[] {
  const given = normalizeName(q.givenName);
  const surname = q.surname ? normalizeName(q.surname) : '';
  const scored: { c: T; score: number }[] = [];
  for (const c of candidates) {
    const givens = names(c.givenName, c.nickname);
    if (!givens.some((g) => close(g, given))) continue;
    const surnames = names(c.surname, c.maidenName);
    if (surname && surnames.length > 0 && !surnames.some((s) => close(s, surname))) continue;
    if (
      q.birthYear !== undefined &&
      c.birthYear !== null &&
      Math.abs(c.birthYear - q.birthYear) > BIRTH_YEAR_SLACK
    ) {
      continue;
    }
    const score =
      (givens.includes(given) ? 2 : 0) +
      (surname && surnames.includes(surname) ? 2 : 0) +
      (q.birthYear !== undefined && c.birthYear === q.birthYear ? 1 : 0);
    scored.push({ c, score });
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.c.surname ?? '').localeCompare(b.c.surname ?? '') ||
        a.c.givenName.localeCompare(b.c.givenName),
    )
    .slice(0, limit)
    .map((s) => s.c);
}
