import { type ExportData, type ExportPerson, type FuzzyDate, NAME_MAX } from '@family-tree/shared';
import { describe, expect, it } from 'vitest';
import { buildGedcom, gedcomDate, personXrefs, photoFileName } from './gedcom.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-10T09:05:03Z');
const opts = { exporterName: 'Olive Owner', now: NOW };
const exact = (date1: string): FuzzyDate => ({ qualifier: 'exact', date1 });

function person(n: number, over: Partial<ExportPerson>): ExportPerson {
  return {
    id: id(n),
    givenName: 'X',
    middleName: null,
    surname: null,
    maidenName: null,
    nickname: null,
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
    siblingOrder: null,
    ...over,
  };
}

function sample(): ExportData {
  return {
    format: 'family-tree-export',
    version: 1,
    exportedAt: NOW.toISOString(),
    tree: { id: id(100), name: 'Owner family', rootPersonId: id(1) },
    persons: [
      person(1, {
        givenName: 'Olive',
        middleName: 'Ann',
        surname: 'Owner',
        maidenName: 'Smith',
        nickname: 'Liv',
        sex: 'female',
        birthDate: exact('1950-03-12'),
        birthPlace: 'Toronto, Canada',
      }),
      person(2, {
        givenName: 'Bob',
        surname: 'Owner',
        sex: 'male',
        birthDate: { qualifier: 'about', date1: '1948' },
        deathDate: { qualifier: 'between', date1: '2010', date2: '2012' },
        deathPlace: 'Leeds',
        causeOfDeath: 'Heart failure',
        isLiving: false,
        occupation: 'Teacher',
        biography: 'Line one\nLine two',
      }),
      person(3, {
        givenName: 'Cleo',
        surname: 'Owner',
        sex: 'female',
        birthDate: exact('1975-06'),
        siblingOrder: 2,
      }),
      person(4, {
        givenName: 'Dan',
        surname: 'Owner',
        sex: 'male',
        siblingOrder: 1,
        notes: 'Email: dan@example.com',
      }),
      person(5, { givenName: 'Eve', sex: 'other', isLiving: false }),
    ],
    unions: [
      {
        id: id(11),
        partnerAId: id(1),
        partnerBId: id(2),
        type: 'marriage',
        status: 'divorced',
        startDate: exact('1972-06-01'),
        endDate: exact('1990'),
      },
      {
        id: id(12),
        partnerAId: id(2),
        partnerBId: null,
        type: 'marriage',
        status: 'married',
        startDate: null,
        endDate: null,
      },
    ],
    parentChild: [
      { id: id(21), unionId: id(11), childId: id(3), kind: 'biological' },
      { id: id(22), unionId: id(11), childId: id(4), kind: 'adoptive' },
      { id: id(23), unionId: id(12), childId: id(5), kind: 'step' },
    ],
    residences: [
      {
        id: id(31),
        personId: id(1),
        place: 'Leeds',
        fromDate: exact('1970'),
        toDate: { qualifier: 'about', date1: '1980' },
      },
    ],
    photos: [
      {
        id: id(41),
        personId: id(1),
        file: 'photos/I1-1.webp',
        width: 10,
        height: 10,
        isPrimary: true,
      },
      {
        id: id(42),
        personId: id(1),
        file: 'photos/I1-2.webp',
        width: 10,
        height: 10,
        isPrimary: false,
      },
      { id: id(43), personId: id(2), file: null, width: 10, height: 10, isPrimary: true },
    ],
  };
}

const EXPECTED = [
  '0 HEAD',
  '1 SOUR FAMILY-TREE',
  '2 VERS 1',
  '2 NAME Family Tree',
  '1 DATE 10 NOV 2026',
  '2 TIME 09:05:03',
  '1 SUBM @U1@',
  '1 FILE tree.ged',
  '1 GEDC',
  '2 VERS 5.5.1',
  '2 FORM LINEAGE-LINKED',
  '1 CHAR UTF-8',
  '0 @U1@ SUBM',
  '1 NAME Olive Owner',
  '0 @I1@ INDI',
  '1 NAME Olive Ann /Owner/',
  '2 GIVN Olive Ann',
  '2 SURN Owner',
  '2 NICK Liv',
  '1 NAME Olive Ann /Smith/',
  '2 GIVN Olive Ann',
  '2 SURN Smith',
  '2 TYPE maiden',
  '1 SEX F',
  '1 BIRT',
  '2 DATE 12 MAR 1950',
  '2 PLAC Toronto, Canada',
  '1 RESI',
  '2 DATE FROM 1970 TO 1980',
  '2 PLAC Leeds',
  '1 FAMS @F1@',
  '1 OBJE @O1@',
  '1 OBJE @O2@',
  '0 @I2@ INDI',
  '1 NAME Bob /Owner/',
  '2 GIVN Bob',
  '2 SURN Owner',
  '1 SEX M',
  '1 BIRT',
  '2 DATE ABT 1948',
  '1 DEAT',
  '2 DATE BET 2010 AND 2012',
  '2 PLAC Leeds',
  '2 CAUS Heart failure',
  '1 OCCU Teacher',
  '1 FAMS @F1@',
  '1 FAMS @F2@',
  '1 NOTE Line one',
  '2 CONT Line two',
  '0 @I3@ INDI',
  '1 NAME Cleo /Owner/',
  '2 GIVN Cleo',
  '2 SURN Owner',
  '1 SEX F',
  '1 BIRT',
  '2 DATE JUN 1975',
  '1 FAMC @F1@',
  '2 PEDI birth',
  '0 @I4@ INDI',
  '1 NAME Dan /Owner/',
  '2 GIVN Dan',
  '2 SURN Owner',
  '1 SEX M',
  '1 FAMC @F1@',
  '2 PEDI adopted',
  '1 NOTE Email: dan@@example.com',
  '0 @I5@ INDI',
  '1 NAME Eve',
  '2 GIVN Eve',
  '1 SEX U',
  '1 DEAT Y',
  '1 FAMC @F2@',
  '2 NOTE Step-child',
  '0 @F1@ FAM',
  '1 MARR',
  '2 DATE 1 JUN 1972',
  '1 DIV',
  '2 DATE 1990',
  '1 HUSB @I2@',
  '1 WIFE @I1@',
  '1 CHIL @I4@',
  '1 CHIL @I3@',
  '0 @F2@ FAM',
  '1 HUSB @I2@',
  '1 CHIL @I5@',
  '0 @O1@ OBJE',
  '1 FILE photos/I1-1.webp',
  '2 FORM webp',
  '3 TYPE photo',
  '0 @O2@ OBJE',
  '1 FILE photos/I1-2.webp',
  '2 FORM webp',
  '3 TYPE photo',
  '0 TRLR',
];

const linesOf = (ged: string) => ged.replace(/^﻿/, '').split('\r\n').slice(0, -1);

/** Joins a NOTE back together: CONT is a line break, CONC continues the same line. */
function noteText(lines: string[], start: number): string {
  let text = lines[start]!.replace(/^1 NOTE ?/, '');
  for (let i = start + 1; lines[i]?.startsWith('2 CON'); i++) {
    const [, tag, value = ''] = /^2 (CONT|CONC) ?(.*)$/.exec(lines[i]!)!;
    text += tag === 'CONT' ? `\n${value}` : value;
  }
  return text.replaceAll('@@', '@');
}

describe('gedcomDate', () => {
  it.each([
    [exact('1950'), '1950'],
    [exact('1950-03'), 'MAR 1950'],
    [exact('1950-03-02'), '2 MAR 1950'],
    [{ qualifier: 'about', date1: '1950-12' } as FuzzyDate, 'ABT DEC 1950'],
    [{ qualifier: 'before', date1: '1901' } as FuzzyDate, 'BEF 1901'],
    [{ qualifier: 'after', date1: '0950' } as FuzzyDate, 'AFT 950'],
    [
      { qualifier: 'between', date1: '1950-06', date2: '1951' } as FuzzyDate,
      'BET JUN 1950 AND 1951',
    ],
  ])('%j → %s', (date, expected) => {
    expect(gedcomDate(date)).toBe(expected);
  });
});

describe('buildGedcom', () => {
  it('writes the whole sample tree exactly, UTF-8 with a BOM and CRLF', () => {
    const ged = buildGedcom(sample(), opts);
    expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
    expect(ged.endsWith('0 TRLR\r\n')).toBe(true);
    expect(ged).not.toMatch(/[^\r]\n/);
    expect(linesOf(ged)).toEqual(EXPECTED);
  });

  it('is deterministic', () => {
    expect(buildGedcom(sample(), opts)).toBe(buildGedcom(sample(), opts));
  });

  it('splits long notes with CONC under 255 bytes, never next to a space or inside @@', () => {
    for (const bio of [
      'a'.repeat(450),
      'word '.repeat(120),
      'Zoë 🌳 Núñez — ü '.repeat(40),
      '@'.repeat(301),
      'mail me@x.org '.repeat(50),
    ]) {
      const data = sample();
      data.persons[0] = { ...data.persons[0]!, biography: bio };
      const lines = linesOf(buildGedcom(data, opts));
      for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(255);
      const start = lines.findIndex((l) => l.startsWith('1 NOTE'));
      expect(noteText(lines, start)).toBe(bio);
      for (let i = start + 1; lines[i]?.startsWith('2 CONC'); i++) {
        const prev = lines[i - 1]!;
        expect(prev.endsWith(' ')).toBe(false);
        expect(lines[i]!.slice('2 CONC '.length).startsWith(' ')).toBe(false);
        // An odd run of @ at a line end would be half of an escaped "@@".
        expect((/@+$/.exec(prev)?.[0].length ?? 0) % 2).toBe(0);
      }
    }
  });

  it('keeps blank lines in notes as empty CONT lines', () => {
    const data = sample();
    data.persons[3] = { ...data.persons[3]!, notes: 'one\n\nthree\r\nfour' };
    const lines = linesOf(buildGedcom(data, opts));
    const at = lines.indexOf('1 NOTE one');
    expect(lines.slice(at, at + 4)).toEqual([
      '1 NOTE one',
      '2 CONT',
      '2 CONT three',
      '2 CONT four',
    ]);
  });

  it('flattens and shortens single-line values, and keeps slashes out of names', () => {
    const data = sample();
    data.persons[0] = {
      ...data.persons[0]!,
      givenName: 'Anne/Marie',
      birthPlace: `Long\nplace ${'x'.repeat(300)}`,
    };
    const lines = linesOf(buildGedcom(data, opts));
    expect(lines).toContain('1 NAME Anne Marie Ann /Owner/');
    const plac = lines.find((l) => l.startsWith('2 PLAC Long place '))!;
    expect(Buffer.byteLength(plac.slice('2 PLAC '.length), 'utf8')).toBeLessThanOrEqual(240);
    expect(plac.endsWith('…')).toBe(true);
  });

  it('assigns HUSB and WIFE by sex, positionally otherwise', () => {
    const data = sample();
    const p = (n: number) => data.persons[n - 1]!;
    const fam = (a: string | null, b: string | null) => {
      data.unions = [{ ...data.unions[0]!, partnerAId: a, partnerBId: b }];
      data.parentChild = [];
      return linesOf(buildGedcom(data, opts)).filter((l) => /^1 (HUSB|WIFE)/.test(l));
    };
    expect(fam(p(1).id, p(3).id)).toEqual(['1 HUSB @I1@', '1 WIFE @I3@']); // two women
    expect(fam(p(2).id, p(4).id)).toEqual(['1 HUSB @I2@', '1 WIFE @I4@']); // two men
    expect(fam(p(1).id, p(2).id)).toEqual(['1 HUSB @I2@', '1 WIFE @I1@']);
    expect(fam(p(1).id, null)).toEqual(['1 WIFE @I1@']);
    expect(fam(null, p(5).id)).toEqual(['1 HUSB @I5@']);
  });

  it('writes partnerships and separations as typed EVENs', () => {
    const data = sample();
    data.unions = [
      {
        ...data.unions[0]!,
        type: 'partnership',
        status: 'separated',
        startDate: { qualifier: 'after', date1: '1990' },
        endDate: exact('1995'),
      },
    ];
    const lines = linesOf(buildGedcom(data, opts));
    const at = lines.indexOf('0 @F1@ FAM');
    expect(lines.slice(at + 1, at + 7)).toEqual([
      '1 EVEN',
      '2 TYPE Partnership',
      '2 DATE AFT 1990',
      '1 EVEN',
      '2 TYPE Separation',
      '2 DATE 1995',
    ]);
  });

  it('marks undated marriages and divorces with Y', () => {
    const data = sample();
    data.unions = [{ ...data.unions[0]!, startDate: null, endDate: null }];
    const lines = linesOf(buildGedcom(data, opts));
    expect(lines).toContain('1 MARR Y');
    expect(lines).toContain('1 DIV Y');
  });

  it('splits CJK names at NAME_MAX over CONC lines of at most 255 bytes', () => {
    const data = sample();
    const given = '張'.repeat(NAME_MAX);
    const surname = '欧阳'.repeat(NAME_MAX / 2);
    data.persons[0] = {
      ...data.persons[0]!,
      givenName: given,
      middleName: null,
      surname,
      maidenName: null,
      nickname: '小'.repeat(NAME_MAX),
    };
    const lines = linesOf(buildGedcom(data, opts));
    for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(255);
    const at = lines.indexOf('0 @I1@ INDI') + 1;
    expect(lines[at]!.startsWith('1 NAME ')).toBe(true);
    let value = lines[at]!.slice('1 NAME '.length);
    for (let i = at + 1; lines[i]?.startsWith('2 CONC '); i++)
      value += lines[i]!.slice('2 CONC '.length);
    expect(value).toBe(`${given} /${surname}/`);
    expect(lines.some((l) => l.startsWith('3 CONC '))).toBe(true); // GIVN, SURN and NICK continue too
  });

  it('strips C0 control characters from every value', () => {
    const data = sample();
    data.persons[0] = {
      ...data.persons[0]!,
      givenName: 'Ol\u0000ive\u001b',
      birthPlace: 'Tor\u0007onto',
      biography: 'a\u0001b\nc\td',
    };
    const ged = buildGedcom(data, opts);
    expect(ged).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    const lines = linesOf(ged);
    expect(lines).toContain('1 NAME Olive Ann /Owner/');
    expect(lines).toContain('2 PLAC Toronto');
    expect(lines).toContain('1 NOTE ab');
    expect(lines).toContain('2 CONT c d');
  });

  it('names photo files after the person xref', () => {
    const xrefs = personXrefs(sample().persons);
    expect(xrefs.get(id(2))).toBe('@I2@');
    expect(photoFileName('@I2@', 3)).toBe('photos/I2-3.webp');
  });
});
