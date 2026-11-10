import {
  type ChildKind,
  type ExportData,
  type ExportPerson,
  type FuzzyDate,
  sortYear,
} from '@family-tree/shared';

/**
 * GEDCOM 5.5.1 (spec §7) from an export snapshot (decision 6). Pure: same data, same bytes.
 * UTF-8 with a BOM, CRLF, at most 255 bytes per line.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SEX: Record<ExportPerson['sex'], string> = {
  female: 'F',
  male: 'M',
  other: 'U',
  unknown: 'U',
};
const PEDI: Record<ChildKind, string | null> = {
  biological: 'birth',
  adoptive: 'adopted',
  foster: 'foster',
  step: null, // 5.5.1 has no step value: written as a NOTE instead
};
/** Continuation chunks stay under 255 bytes per line with room for "2 CONC ". */
const CHUNK_BYTES = 200;
/** Single-line values are cut here (with "…"); tree.json keeps the full text. */
const VALUE_BYTES = 240;

/** "1950", "MAR 1950" or "2 MAR 1950" from YYYY, YYYY-MM or YYYY-MM-DD. */
export function gedcomPartialDate(partial: string): string {
  const [y, m, d] = partial.split('-');
  const year = String(Number(y));
  if (!m) return year;
  const month = MONTHS[Number(m) - 1]!;
  return d ? `${Number(d)} ${month} ${year}` : `${month} ${year}`;
}

export function gedcomDate(date: FuzzyDate): string {
  const d1 = gedcomPartialDate(date.date1);
  switch (date.qualifier) {
    case 'exact':
      return d1;
    case 'about':
      return `ABT ${d1}`;
    case 'before':
      return `BEF ${d1}`;
    case 'after':
      return `AFT ${d1}`;
    case 'between':
      return `BET ${d1} AND ${gedcomPartialDate(date.date2 ?? date.date1)}`;
  }
}

/** Residence periods take plain dates in 5.5.1, so the qualifier is dropped (decision 6). */
function datePeriod(from: FuzzyDate | null, to: FuzzyDate | null): string | null {
  const parts = [
    from ? `FROM ${gedcomPartialDate(from.date1)}` : '',
    to ? `TO ${gedcomPartialDate(to.date1)}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

export function personXrefs(persons: readonly { id: string }[]): Map<string, string> {
  return new Map(persons.map((p, i) => [p.id, `@I${i + 1}@`]));
}

/** "photos/I3-1.webp": the person's xref and the photo's position (primary first). */
export const photoFileName = (personXref: string, n: number) =>
  `photos/${personXref.slice(1, -1)}-${n}.webp`;

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

/** C0 control characters and DEL never reach the file; tab and line breaks are handled apart. */
const stripControls = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

function line(level: number, tag: string, value?: string, xref?: string): string {
  return `${level}${xref ? ` ${xref}` : ''} ${tag}${value ? ` ${value}` : ''}`;
}

/** One line of text, whitespace collapsed, "@" escaped, cut at VALUE_BYTES with "…". */
function oneLine(value: string): string {
  const atoms = Array.from(stripControls(value).replace(/\s+/g, ' ').trim(), (c) =>
    c === '@' ? '@@' : c,
  );
  const total = atoms.reduce((n, a) => n + bytes(a), 0);
  if (total <= VALUE_BYTES) return atoms.join('');
  let out = '';
  let size = 0;
  for (const a of atoms) {
    if (size + bytes(a) + bytes('…') > VALUE_BYTES) break;
    out += a;
    size += bytes(a);
  }
  return `${out}…`;
}

/** A name part: no controls, no slashes (they delimit the surname), single spaces. Not escaped. */
const namePart = (s: string) => stripControls(s).replaceAll('/', ' ').replace(/\s+/g, ' ').trim();

/**
 * Splits one paragraph into chunks of at most CHUNK_BYTES. Each escaped "@@" is one atom, so it
 * is never split. A split moves back until neither side is a space (readers trim them); with no
 * such point it falls back to the byte limit.
 */
function chunks(paragraph: string): string[] {
  const atoms = Array.from(paragraph, (c) => (c === '@' ? '@@' : c));
  const out: string[] = [];
  let start = 0;
  while (start < atoms.length) {
    let end = start;
    let size = 0;
    while (end < atoms.length && size + bytes(atoms[end]!) <= CHUNK_BYTES) {
      size += bytes(atoms[end]!);
      end++;
    }
    if (end < atoms.length) {
      let e = end;
      while (e > start + 1 && (atoms[e - 1] === ' ' || atoms[e] === ' ')) e--;
      if (e > start + 1) end = e;
    }
    out.push(atoms.slice(start, end).join(''));
    start = end;
  }
  return out.length > 0 ? out : [''];
}

/** A one-line value that may be long (names, review fix I4): CONC keeps each line ≤ 255 bytes. */
function longLine(level: number, tag: string, value: string): string[] {
  return chunks(value).map((c, j) => (j === 0 ? line(level, tag, c) : line(level + 1, 'CONC', c)));
}

/** A text value over several lines: line breaks become CONT, long lines continue with CONC. */
function textLines(level: number, tag: string, text: string): string[] {
  const out: string[] = [];
  stripControls(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .forEach((paragraph, i) => {
      chunks(paragraph).forEach((c, j) => {
        if (i === 0 && j === 0) out.push(line(level, tag, c));
        else out.push(line(level + 1, j === 0 ? 'CONT' : 'CONC', c));
      });
    });
  return out;
}

/** HUSB/WIFE (decision 6): by sex when exactly one partner is female, positionally otherwise. */
function roles(a: ExportPerson | null, b: ExportPerson | null) {
  if (a && b) {
    if (a.sex === 'female' && b.sex !== 'female') return { husb: b, wife: a };
    return { husb: a, wife: b };
  }
  const only = a ?? b;
  return only?.sex === 'female' ? { husb: null, wife: only } : { husb: only, wife: null };
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface GedcomOptions {
  /** The SUBM record's name: the exporting owner. */
  exporterName: string;
  now: Date;
}

export function buildGedcom(data: ExportData, { exporterName, now }: GedcomOptions): string {
  const out: string[] = [];
  const add = (level: number, tag: string, value?: string, xref?: string) =>
    out.push(line(level, tag, value, xref));

  const indi = personXrefs(data.persons);
  const fam = new Map(data.unions.map((u, i) => [u.id, `@F${i + 1}@`]));
  const shown = data.photos.filter((p) => p.file !== null);
  const obje = new Map(shown.map((p, i) => [p.id, `@O${i + 1}@`]));
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const order = new Map(data.persons.map((p, i) => [p.id, i]));

  const famc = new Map<string, { unionId: string; kind: ChildKind }[]>();
  for (const l of data.parentChild) append(famc, l.childId, l);
  const fams = new Map<string, string[]>();
  for (const u of data.unions) {
    for (const pid of [u.partnerAId, u.partnerBId]) if (pid) append(fams, pid, u.id);
  }
  const photosOf = new Map<string, string[]>();
  for (const p of shown) append(photosOf, p.personId, p.id);
  const homes = new Map<string, ExportData['residences']>();
  for (const r of data.residences) append(homes, r.personId, r);
  const kids = new Map<string, ExportPerson[]>();
  for (const l of data.parentChild) append(kids, l.unionId, byId.get(l.childId)!);

  // Header (5.5.1 order: SOUR, DATE, SUBM, FILE, GEDC, CHAR) and the submitter.
  const iso = now.toISOString();
  add(0, 'HEAD');
  add(1, 'SOUR', 'FAMILY-TREE');
  add(2, 'VERS', '1');
  add(2, 'NAME', 'Family Tree');
  add(1, 'DATE', gedcomPartialDate(iso.slice(0, 10)));
  add(2, 'TIME', iso.slice(11, 19));
  add(1, 'SUBM', '@U1@');
  add(1, 'FILE', 'tree.ged');
  add(1, 'GEDC');
  add(2, 'VERS', '5.5.1');
  add(2, 'FORM', 'LINEAGE-LINKED');
  add(1, 'CHAR', 'UTF-8');
  add(0, 'SUBM', undefined, '@U1@');
  add(1, 'NAME', oneLine(exporterName) || 'Unknown');

  const event = (
    tag: 'BIRT' | 'DEAT',
    date: FuzzyDate | null,
    place: string | null,
    cause: string | null = null,
  ) => {
    if (!date && !place && !cause) {
      if (tag === 'DEAT') add(1, 'DEAT', 'Y');
      return;
    }
    add(1, tag);
    if (date) add(2, 'DATE', gedcomDate(date));
    if (place) add(2, 'PLAC', oneLine(place));
    if (cause) add(2, 'CAUS', oneLine(cause));
  };
  const name = (given: string, surname: string | null) => {
    const sur = surname ? namePart(surname) : '';
    out.push(...longLine(1, 'NAME', sur ? `${given} /${sur}/` : given));
    out.push(...longLine(2, 'GIVN', given));
    if (sur) out.push(...longLine(2, 'SURN', sur));
  };

  // Individuals (5.5.1 order: NAME, SEX, events, attributes, FAMC, FAMS, OBJE, NOTE).
  for (const p of data.persons) {
    add(0, 'INDI', undefined, indi.get(p.id));
    const given = [p.givenName, p.middleName]
      .filter((s): s is string => !!s)
      .map(namePart)
      .join(' ');
    name(given, p.surname);
    if (p.nickname) out.push(...longLine(2, 'NICK', namePart(p.nickname)));
    if (p.maidenName) {
      name(given, p.maidenName);
      add(2, 'TYPE', 'maiden');
    }
    add(1, 'SEX', SEX[p.sex]);
    event('BIRT', p.birthDate, p.birthPlace);
    if (!p.isLiving || p.deathDate || p.deathPlace || p.causeOfDeath) {
      event('DEAT', p.deathDate, p.deathPlace, p.causeOfDeath);
    }
    if (p.occupation) add(1, 'OCCU', oneLine(p.occupation));
    if (p.education) add(1, 'EDUC', oneLine(p.education));
    for (const r of homes.get(p.id) ?? []) {
      add(1, 'RESI');
      const period = datePeriod(r.fromDate, r.toDate);
      if (period) add(2, 'DATE', period);
      add(2, 'PLAC', oneLine(r.place));
    }
    for (const l of famc.get(p.id) ?? []) {
      add(1, 'FAMC', fam.get(l.unionId));
      const pedi = PEDI[l.kind];
      if (pedi) add(2, 'PEDI', pedi);
      else add(2, 'NOTE', 'Step-child');
    }
    for (const u of fams.get(p.id) ?? []) add(1, 'FAMS', fam.get(u));
    for (const ph of photosOf.get(p.id) ?? []) add(1, 'OBJE', obje.get(ph));
    if (p.biography) out.push(...textLines(1, 'NOTE', p.biography));
    if (p.notes) out.push(...textLines(1, 'NOTE', p.notes));
  }

  // Families (5.5.1 order: events, HUSB, WIFE, CHIL).
  const birthYear = (p: ExportPerson) =>
    p.birthDate ? sortYear(p.birthDate) : Number.POSITIVE_INFINITY;
  const childOrder = (a: ExportPerson, b: ExportPerson) =>
    (a.siblingOrder ?? Number.POSITIVE_INFINITY) - (b.siblingOrder ?? Number.POSITIVE_INFINITY) ||
    birthYear(a) - birthYear(b) ||
    order.get(a.id)! - order.get(b.id)!;
  for (const u of data.unions) {
    add(0, 'FAM', undefined, fam.get(u.id));
    const a = u.partnerAId ? (byId.get(u.partnerAId) ?? null) : null;
    const b = u.partnerBId ? (byId.get(u.partnerBId) ?? null) : null;
    // A single known parent is a union too: no marriage is invented for it.
    if ((a && b) || u.startDate) {
      if (u.type === 'marriage') add(1, 'MARR', u.startDate ? undefined : 'Y');
      else {
        add(1, 'EVEN');
        add(2, 'TYPE', 'Partnership');
      }
      if (u.startDate) add(2, 'DATE', gedcomDate(u.startDate));
    }
    if (u.status === 'divorced') {
      add(1, 'DIV', u.endDate ? undefined : 'Y');
      if (u.endDate) add(2, 'DATE', gedcomDate(u.endDate));
    } else if (u.status === 'separated') {
      add(1, 'EVEN');
      add(2, 'TYPE', 'Separation');
      if (u.endDate) add(2, 'DATE', gedcomDate(u.endDate));
    }
    const { husb, wife } = roles(a, b);
    if (husb) add(1, 'HUSB', indi.get(husb.id));
    if (wife) add(1, 'WIFE', indi.get(wife.id));
    for (const k of [...(kids.get(u.id) ?? [])].sort(childOrder)) add(1, 'CHIL', indi.get(k.id));
  }

  // Media: the photos that made it into the ZIP, in export order.
  for (const ph of shown) {
    add(0, 'OBJE', undefined, obje.get(ph.id));
    add(1, 'FILE', ph.file!);
    add(2, 'FORM', 'webp');
    add(3, 'TYPE', 'photo');
  }
  add(0, 'TRLR');
  return `﻿${out.join('\r\n')}\r\n`;
}
