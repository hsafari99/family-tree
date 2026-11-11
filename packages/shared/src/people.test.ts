import { describe, expect, it } from 'vitest';
import {
  addRelativeSchema,
  createPersonSchema,
  personConsistencyErrors,
  residenceInputSchema,
  updatePersonSchema,
  updateUnionSchema,
} from './people.js';
import { FUTURE_DATE_MESSAGE } from './fuzzy-date.js';

const year = (y: string) => ({ qualifier: 'exact' as const, date1: y });

describe('createPersonSchema', () => {
  it('fills defaults for a quick add', () => {
    const r = createPersonSchema.parse({ person: { givenName: '  Ada ' } });
    expect(r.person).toMatchObject({
      givenName: 'Ada',
      sex: 'unknown',
      birthDate: null,
      deathDate: null,
      isLiving: true,
    });
    expect(r.attach).toBeUndefined();
  });

  it('turns blank optional text into null', () => {
    const r = createPersonSchema.parse({ person: { givenName: 'Ada', surname: '   ' } });
    expect(r.person.surname).toBeNull();
  });

  it('treats someone with death details as not living unless told otherwise', () => {
    const r = createPersonSchema.parse({ person: { givenName: 'Ada', deathDate: year('1852') } });
    expect(r.person.isLiving).toBe(false);
    const bad = createPersonSchema.safeParse({
      person: { givenName: 'Ada', isLiving: true, causeOfDeath: 'Illness' },
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(['person', 'isLiving']);
  });

  it('rejects a death before the birth', () => {
    const bad = createPersonSchema.safeParse({
      person: { givenName: 'Ada', birthDate: year('1900'), deathDate: year('1850') },
    });
    expect(bad.error?.issues[0]?.path).toEqual(['person', 'deathDate']);
  });

  it('rejects a birth or death date in the future', () => {
    const next = year(String(new Date().getUTCFullYear() + 1));
    for (const field of ['birthDate', 'deathDate'] as const) {
      const bad = createPersonSchema.safeParse({ person: { givenName: 'Ada', [field]: next } });
      expect(bad.error?.issues).toEqual([
        expect.objectContaining({ path: ['person', field], message: FUTURE_DATE_MESSAGE }),
      ]);
    }
  });

  it('accepts an attach spec with a default kind', () => {
    const to = crypto.randomUUID();
    const r = createPersonSchema.parse({
      person: { givenName: 'Kid' },
      attach: { to, as: 'child' },
    });
    expect(r.attach).toEqual({ to, as: 'child', kind: 'biological' });
    expect(
      createPersonSchema.safeParse({ person: { givenName: 'X' }, attach: { to, as: 'cousin' } })
        .success,
    ).toBe(false);
  });

  it('limits long text', () => {
    const r = createPersonSchema.safeParse({
      person: { givenName: 'Ada', biography: 'x'.repeat(10_001) },
    });
    expect(r.success).toBe(false);
  });
});

describe('updatePersonSchema', () => {
  it('needs a version and at least one field', () => {
    expect(updatePersonSchema.safeParse({ surname: 'X' }).success).toBe(false);
    expect(updatePersonSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updatePersonSchema.parse({ version: 3, surname: '' })).toEqual({
      version: 3,
      surname: null,
    });
  });

  it('rejects a birth or death date in the future', () => {
    const next = year(String(new Date().getUTCFullYear() + 1));
    for (const field of ['birthDate', 'deathDate'] as const) {
      const bad = updatePersonSchema.safeParse({ version: 1, [field]: next });
      expect(bad.error?.issues).toEqual([
        expect.objectContaining({ path: [field], message: FUTURE_DATE_MESSAGE }),
      ]);
    }
  });

  it('can clear a date', () => {
    expect(updatePersonSchema.parse({ version: 1, birthDate: null }).birthDate).toBeNull();
  });
});

describe('personConsistencyErrors', () => {
  it('is empty for a consistent person', () => {
    expect(personConsistencyErrors({ isLiving: false, deathDate: year('1990') })).toEqual({});
  });
  it('flags living with a death place', () => {
    expect(personConsistencyErrors({ isLiving: true, deathPlace: 'Paris' })).toHaveProperty(
      'isLiving',
    );
  });
});

describe('relation inputs', () => {
  it('addRelativeSchema needs a person id', () => {
    expect(addRelativeSchema.safeParse({ as: 'partner' }).success).toBe(false);
    const personId = crypto.randomUUID();
    expect(addRelativeSchema.parse({ personId, as: 'partner' })).toEqual({
      personId,
      as: 'partner',
      kind: 'biological',
    });
  });
  it('updateUnionSchema refuses an empty change and an end before the start', () => {
    expect(updateUnionSchema.safeParse({}).success).toBe(false);
    expect(updateUnionSchema.parse({ status: 'divorced' })).toEqual({ status: 'divorced' });
    const bad = updateUnionSchema.safeParse({ startDate: year('1990'), endDate: year('1980') });
    expect(bad.error?.issues[0]?.path).toEqual(['endDate']);
  });
  it('residenceInputSchema needs a place', () => {
    expect(residenceInputSchema.safeParse({ place: ' ' }).success).toBe(false);
    expect(residenceInputSchema.parse({ place: 'Leeds' })).toEqual({
      place: 'Leeds',
      fromDate: null,
      toDate: null,
    });
  });
});
