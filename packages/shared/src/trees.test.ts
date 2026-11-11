import { describe, expect, it } from 'vitest';
import { ROLE_RANK } from './permissions.js';
import {
  createInviteSchema,
  createTreeSchema,
  grantStewardSchema,
  quickPersonSchema,
  updateTreeSchema,
} from './trees.js';

const uuid = '0b0c8a4e-1f7e-4c1a-9a51-6a2a3c9d0e11';

describe('createTreeSchema', () => {
  it('trims names and defaults sex to unknown', () => {
    const r = createTreeSchema.parse({
      name: '  Hale family ',
      person: { givenName: ' Leo ', surname: ' Hale ' },
    });
    expect(r).toEqual({
      name: 'Hale family',
      person: { givenName: 'Leo', surname: 'Hale', sex: 'unknown' },
    });
  });
  it('turns an empty surname into undefined', () => {
    const r = createTreeSchema.parse({ name: 'x', person: { givenName: 'Leo', surname: '  ' } });
    expect(r.person.surname).toBeUndefined();
  });
  it('rejects an empty tree name, a missing given name and a future birth year', () => {
    expect(createTreeSchema.safeParse({ name: ' ', person: { givenName: 'a' } }).success).toBe(
      false,
    );
    expect(createTreeSchema.safeParse({ name: 'x', person: { givenName: '' } }).success).toBe(
      false,
    );
    const next = new Date().getUTCFullYear() + 1;
    expect(
      createTreeSchema.safeParse({ name: 'x', person: { givenName: 'a', birthYear: next } })
        .success,
    ).toBe(false);
  });
  it('takes a fuzzy birth date, but not with a birth year too', () => {
    const date = { qualifier: 'about', date1: '1950-03' } as const;
    expect(quickPersonSchema.parse({ givenName: 'A', birthDate: date }).birthDate).toEqual(date);
    const both = quickPersonSchema.safeParse({ givenName: 'A', birthYear: 1950, birthDate: date });
    expect(both.success).toBe(false);
    expect(both.error!.issues).toEqual([
      expect.objectContaining({
        path: ['birthDate'],
        message: 'Give a birth date or a birth year, not both',
      }),
    ]);
  });
  it('rejects names over 100 characters', () => {
    expect(
      createTreeSchema.safeParse({ name: 'x'.repeat(101), person: { givenName: 'a' } }).success,
    ).toBe(false);
  });
});

describe('updateTreeSchema', () => {
  it('needs at least one field', () => {
    expect(updateTreeSchema.safeParse({}).success).toBe(false);
    expect(updateTreeSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(updateTreeSchema.safeParse({ rootPersonId: uuid }).success).toBe(true);
  });
});

describe('createInviteSchema', () => {
  it('defaults the optional people to null and refuses the owner role', () => {
    expect(createInviteSchema.parse({ role: 'viewer' })).toEqual({
      role: 'viewer',
      stewardAnchorPersonId: null,
      targetPersonId: null,
    });
    expect(createInviteSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });
});

describe('grantStewardSchema', () => {
  it('needs uuids', () => {
    expect(grantStewardSchema.safeParse({ userId: 'x', anchorPersonId: uuid }).success).toBe(false);
  });
});

describe('ROLE_RANK', () => {
  it('orders viewer < editor < owner', () => {
    expect(ROLE_RANK.viewer).toBeLessThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeLessThan(ROLE_RANK.owner);
  });
});
