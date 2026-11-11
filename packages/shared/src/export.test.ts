import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_MAX_PHOTO_BYTES,
  EXPORT_VERSION,
  exportDataSchema,
} from './export.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const sample = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: '2026-11-10T09:05:03.000Z',
  tree: { id: id(100), name: 'Owner family', rootPersonId: id(1) },
  persons: [
    {
      id: id(1),
      givenName: 'Olive',
      middleName: null,
      surname: 'Owner',
      maidenName: null,
      nickname: null,
      sex: 'female',
      birthDate: { qualifier: 'about', date1: '1950' },
      birthPlace: 'Toronto',
      deathDate: null,
      deathPlace: null,
      causeOfDeath: null,
      isLiving: true,
      occupation: null,
      education: null,
      biography: null,
      notes: null,
      siblingOrder: null,
    },
  ],
  unions: [
    {
      id: id(10),
      partnerAId: id(1),
      partnerBId: null,
      type: 'marriage',
      status: 'married',
      startDate: null,
      endDate: null,
      parentsUnknown: false,
      partnerAOrder: null,
      partnerBOrder: null,
    },
  ],
  parentChild: [],
  residences: [{ id: id(20), personId: id(1), place: 'Leeds', fromDate: null, toDate: null }],
  photos: [
    {
      id: id(30),
      personId: id(1),
      file: 'photos/I1-1.webp',
      width: 1600,
      height: 1200,
      isPrimary: true,
    },
  ],
};

describe('exportDataSchema', () => {
  it('accepts a complete export unchanged', () => {
    expect(exportDataSchema.parse(sample)).toEqual(sample);
  });

  it('names the format and version', () => {
    expect(EXPORT_FORMAT).toBe('family-tree-export');
    expect(EXPORT_VERSION).toBe(1);
  });

  it('rejects another format or version', () => {
    expect(exportDataSchema.safeParse({ ...sample, format: 'other' }).success).toBe(false);
    expect(exportDataSchema.safeParse({ ...sample, version: 2 }).success).toBe(false);
  });

  it('rejects an extra key anywhere, so a loader cannot leak fields like emails', () => {
    const leak = (over: object) => exportDataSchema.safeParse(over).success;
    expect(leak({ ...sample, extra: 1 })).toBe(false);
    expect(leak({ ...sample, tree: { ...sample.tree, createdBy: id(5) } })).toBe(false);
    expect(leak({ ...sample, persons: [{ ...sample.persons[0]!, email: 'a@example.com' }] })).toBe(
      false,
    );
    expect(leak({ ...sample, unions: [{ ...sample.unions[0]!, createdBy: id(5) }] })).toBe(false);
    expect(
      leak({
        ...sample,
        parentChild: [
          { id: id(40), unionId: id(10), childId: id(1), kind: 'biological', createdBy: id(5) },
        ],
      }),
    ).toBe(false);
    expect(leak({ ...sample, residences: [{ ...sample.residences[0]!, createdBy: id(5) }] })).toBe(
      false,
    );
    expect(leak({ ...sample, photos: [{ ...sample.photos[0]!, storageKeyFull: 'trees/x' }] })).toBe(
      false,
    );
  });

  it('allows a photo whose stored object was missing', () => {
    const missing = { ...sample, photos: [{ ...sample.photos[0]!, file: null }] };
    expect(exportDataSchema.safeParse(missing).success).toBe(true);
  });

  it('rejects invalid fuzzy dates and unknown child kinds', () => {
    const badDate = {
      ...sample,
      persons: [{ ...sample.persons[0]!, birthDate: { qualifier: 'between', date1: '1950' } }],
    };
    expect(exportDataSchema.safeParse(badDate).success).toBe(false);
    const badKind = {
      ...sample,
      parentChild: [{ id: id(40), unionId: id(10), childId: id(1), kind: 'godchild' }],
    };
    expect(exportDataSchema.safeParse(badKind).success).toBe(false);
  });

  it('keeps photo bytes well under the 4 GiB ZIP limit', () => {
    expect(EXPORT_MAX_PHOTO_BYTES).toBeLessThan(2 ** 32 - 256 * 2 ** 20);
  });
});
