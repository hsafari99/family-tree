import { describe, expect, it } from 'vitest';
import { assignGenerations } from './generations';
import { graphToFlow } from './graph-to-flow';
import { haleGraph } from './test-fixtures';

describe('assignGenerations', () => {
  it('puts partners in one row and children one row below (in-laws join their partner)', () => {
    const gens = assignGenerations(graphToFlow(haleGraph(), { focusId: null, meId: null }))!;
    expect(Object.fromEntries(gens)).toEqual({
      robert: 0,
      margaret: 0,
      david: 1,
      susan: 1,
      anna: 1,
      laura: 1,
      emma: 2,
      leo: 2,
      mia: 2,
      noah: 2,
    });
  });

  it('pulls a lone parent down to just above their child', () => {
    // A -> B -> C; C + E; W -> E. W has no parents and would otherwise sit in row 0.
    const gens = assignGenerations({
      personIds: ['a', 'b', 'c', 'e', 'w'],
      families: [
        { id: 'f1', partnerIds: ['a'], childIds: ['b'] },
        { id: 'f2', partnerIds: ['b'], childIds: ['c'] },
        { id: 'f3', partnerIds: ['c', 'e'], childIds: [] },
        { id: 'f4', partnerIds: ['w'], childIds: ['e'] },
      ],
    })!;
    expect(Object.fromEntries(gens)).toEqual({ a: 0, b: 1, c: 2, e: 2, w: 1 });
  });

  it('gives up (null) when rows cannot be consistent', () => {
    // X + Y -> Z, and Z is also X's partner: Z would be in its own parents' row.
    expect(
      assignGenerations({
        personIds: ['x', 'y', 'z'],
        families: [
          { id: 'f1', partnerIds: ['x', 'y'], childIds: ['z'] },
          { id: 'f2', partnerIds: ['x', 'z'], childIds: [] },
        ],
      }),
    ).toBeNull();
  });

  it('handles people with no relations and an empty graph', () => {
    expect(Object.fromEntries(assignGenerations({ personIds: ['a'], families: [] })!)).toEqual({
      a: 0,
    });
    expect(assignGenerations({ personIds: [], families: [] })!.size).toBe(0);
  });
});
