import { describe, expect, it } from 'vitest';
import { mergeLinked } from './linked';
import { gl, gp, gu, haleGraph } from './test-fixtures';
import type { LinkedGraph } from '@family-tree/shared';

const LINK = '11111111-1111-4111-8111-111111111111';
const part = (bridgePersonId: string): LinkedGraph => ({
  linkId: LINK,
  tree: { id: '22222222-2222-4222-8222-222222222222', name: 'Chen family' },
  bridgePersonId,
  graph: {
    mode: 'full',
    focusId: null,
    branchId: null,
    total: 2,
    truncated: false,
    needsBranch: false,
    persons: [gp('papa', 'Papa', 1930, { surname: 'Chen' }), gp('mama', 'Mama', 1932)],
    unions: [gu('u-chen', 'papa', 'mama', { childCount: 1 })],
    links: [gl('l-laura', 'u-chen', 'laura')],
  },
});

describe('mergeLinked', () => {
  it('hangs the linked tree off the bridge card, tagged and read-only', () => {
    const merged = mergeLinked(haleGraph(), [part('laura')]);
    const papa = merged.persons.find((p) => p.id === 'papa')!;
    expect(papa.linkedTree).toEqual({ linkId: LINK, name: 'Chen family' });
    expect(papa.canAddRelative).toBe(false);
    expect(merged.unions.find((u) => u.id === 'u-chen')!.canEdit).toBe(false);
    expect(merged.links.some((l) => l.childId === 'laura' && l.unionId === 'u-chen')).toBe(true);
    // The own tree's people are untouched.
    expect(merged.persons.find((p) => p.id === 'laura')!.linkedTree).toBeUndefined();
  });

  it('leaves a linked tree out when its bridge card isn’t in the view', () => {
    const g = haleGraph();
    expect(mergeLinked(g, [part('nobody')])).toBe(g);
  });
});
