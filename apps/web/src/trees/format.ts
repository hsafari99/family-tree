import type { AuditAction, FuzzyDate, PersonSummary } from '@family-tree/shared';

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

/** A birth-year field's text as a number: undefined when blank, NaN when it isn't a finite number. */
export function parseYear(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function partial(d: string): string {
  const [y, m, day] = d.split('-');
  const year = String(Number(y));
  if (!m) return year;
  const month = MONTHS[Number(m) - 1];
  return day ? `${Number(day)} ${month} ${year}` : `${month} ${year}`;
}

/** "about March 1950", "between 1950 and 1955"; '' for no date. */
export function formatFuzzyDate(d: FuzzyDate | null): string {
  if (!d) return '';
  const one = partial(d.date1);
  switch (d.qualifier) {
    case 'exact':
      return one;
    case 'about':
    case 'before':
    case 'after':
      return `${d.qualifier} ${one}`;
    case 'between':
      return `between ${one} and ${partial(d.date2 ?? d.date1)}`;
  }
}

export const SEX_LABEL = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  unknown: 'Not given',
} as const;
export const UNION_TYPE_LABEL = { marriage: 'Marriage', partnership: 'Partnership' } as const;
export const UNION_STATUS_LABEL = {
  married: 'Married',
  partners: 'Partners',
  divorced: 'Divorced',
  separated: 'Separated',
  widowed: 'Widowed',
} as const;
export const CHILD_KIND_LABEL = {
  biological: 'Biological',
  adoptive: 'Adopted',
  step: 'Step',
  foster: 'Foster',
} as const;
export const QUALIFIER_LABEL = {
  exact: 'Exact',
  about: 'About',
  before: 'Before',
  after: 'After',
  between: 'Between',
} as const;
/** Field names in History. */
export const FIELD_LABEL: Record<string, string> = {
  givenName: 'First name',
  middleName: 'Middle name',
  surname: 'Last name',
  maidenName: 'Maiden name',
  nickname: 'Nickname',
  sex: 'Sex',
  birthDate: 'Birth date',
  birthPlace: 'Birth place',
  deathDate: 'Death date',
  deathPlace: 'Death place',
  causeOfDeath: 'Cause of death',
  isLiving: 'Living',
  occupation: 'Occupation',
  education: 'Education',
  biography: 'Biography',
  notes: 'Notes',
};
/** History entry titles; keyed by AuditAction (the Record type makes a missing one a compile error). */
export const ACTION_LABEL: Record<AuditAction, string> = {
  'tree.create': 'Tree started',
  'tree.rename': 'Tree renamed',
  'tree.changeRoot': 'Starting person changed',
  'tree.delete': 'Tree deleted',
  'tree.restore': 'Tree restored',
  'person.create': 'Added',
  'person.update': 'Details changed',
  'person.delete': 'Moved to Trash',
  'union.create': 'Relationship added',
  'union.update': 'Relationship changed',
  'union.delete': 'Relationship removed',
  'link.create': 'Parent and child linked',
  'link.update': 'Parent and child link changed',
  'link.delete': 'Parent and child link removed',
  'link.reorder': 'Children reordered',
  'residence.create': 'Place of residence added',
  'residence.update': 'Place of residence changed',
  'residence.delete': 'Place of residence removed',
  'trash.restore': 'Restored from Trash',
  'trash.erase': 'Erased permanently',
  'member.join': 'Joined the tree',
  'member.role': 'Role changed',
  'member.remove': 'Removed from the tree',
  'ownership.transfer': 'Ownership transferred',
  'steward.grant': 'Made a branch steward',
  'steward.revoke': 'Branch stewardship revoked',
  'invite.create': 'Invite created',
  'invite.revoke': 'Invite revoked',
};
/** A History value as text: dates formatted, booleans as Yes/No, empty as "(empty)". */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object' && 'qualifier' in v) return formatFuzzyDate(v as FuzzyDate);
  return String(v);
}

/** "AL" for Ada Lovelace; the silhouette's initials until photos arrive (phase 6). */
export function initials(p: NameParts): string {
  const first = (s: string | null) => (s ? ([...s.trim()][0] ?? '') : '');
  return (first(p.givenName) + first(p.surname)).toLocaleUpperCase();
}
