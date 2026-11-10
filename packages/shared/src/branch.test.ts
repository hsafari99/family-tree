import { describe, expect, it } from 'vitest';
import { branchOf } from './branch.js';
import { BRANCH_CASES } from './branch-fixtures.js';

describe('branchOf', () => {
  for (const c of BRANCH_CASES) {
    it(c.name, () => {
      expect([...branchOf(c.graph, c.anchor, c.steward)].sort()).toEqual([...c.expected].sort());
    });
  }

  it('terminates on a cycle (bad data must not hang the server)', () => {
    const graph = {
      persons: [
        { id: 'a', createdBy: null },
        { id: 'b', createdBy: null },
      ],
      unions: [
        { id: 'ua', partnerAId: 'a', partnerBId: null },
        { id: 'ub', partnerAId: 'b', partnerBId: null },
      ],
      parentChild: [
        { unionId: 'ua', childId: 'b' },
        { unionId: 'ub', childId: 'a' },
      ],
    };
    expect([...branchOf(graph, 'a', null)].sort()).toEqual(['a', 'b']);
  });
});
