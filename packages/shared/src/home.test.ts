import { describe, expect, it } from 'vitest';
import { ACTIVITY_LIMIT, homeQuerySchema, homeSummarySchema } from './home.js';

const uuid = '0b0c8a4e-1f7e-4c1a-9a51-6a2a3c9d0e11';

describe('homeSummarySchema', () => {
  it('parses tree cards, deleted trees and activity', () => {
    const body = {
      trees: [
        {
          id: uuid,
          name: 'Hale',
          role: 'owner',
          peopleCount: 3,
          updatedAt: '2026-11-11T10:00:00.000Z',
          openInvites: 1,
        },
        {
          id: uuid,
          name: 'Other',
          role: 'viewer',
          peopleCount: 0,
          updatedAt: '2026-11-11T10:00:00.000Z',
          openInvites: null,
        },
      ],
      deletedTrees: [],
      activity: [
        {
          id: uuid,
          treeId: uuid,
          treeName: 'Hale',
          action: 'person.update',
          at: '2026-11-11T10:00:00.000Z',
          by: null,
          person: { id: uuid, name: 'Leo Hale' },
        },
      ],
    };
    expect(homeSummarySchema.parse(body)).toEqual(body);
  });
  it('refuses a negative people count and an unknown action', () => {
    const tree = {
      id: uuid,
      name: 'x',
      role: 'owner',
      peopleCount: -1,
      updatedAt: 'x',
      openInvites: null,
    };
    expect(
      homeSummarySchema.safeParse({ trees: [tree], deletedTrees: [], activity: [] }).success,
    ).toBe(false);
    const person = { id: uuid, name: 'x' };
    const act = {
      id: uuid,
      treeId: uuid,
      treeName: 'x',
      action: 'nope',
      at: 'x',
      by: null,
      person,
    };
    expect(
      homeSummarySchema.safeParse({ trees: [], deletedTrees: [], activity: [act] }).success,
    ).toBe(false);
  });
  it('keeps a small activity limit', () => {
    expect(ACTIVITY_LIMIT).toBeGreaterThan(0);
    expect(ACTIVITY_LIMIT).toBeLessThanOrEqual(50);
  });
});

describe('homeQuerySchema', () => {
  it('takes an optional tree id', () => {
    expect(homeQuerySchema.parse({})).toEqual({});
    expect(homeQuerySchema.parse({ treeId: uuid })).toEqual({ treeId: uuid });
    expect(homeQuerySchema.safeParse({ treeId: 'nope' }).success).toBe(false);
  });
});
