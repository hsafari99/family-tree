import type { PersonSummary } from '@family-tree/shared';

type NameParts = Pick<PersonSummary, 'givenName' | 'middleName' | 'surname'>;
type YearParts = Pick<PersonSummary, 'birthYear' | 'deathYear'>;

/** "Ada King Lovelace": given, middle and surname, skipping the blanks. */
export function personName(p: NameParts): string {
  return [p.givenName, p.middleName, p.surname].filter(Boolean).join(' ');
}

/** "1930–1998", "b. 1990", "d. 1998", or an empty string when neither year is known. */
export function personYears(p: YearParts): string {
  if (p.birthYear != null && p.deathYear != null) return `${p.birthYear}–${p.deathYear}`;
  if (p.birthYear != null) return `b. ${p.birthYear}`;
  if (p.deathYear != null) return `d. ${p.deathYear}`;
  return '';
}
