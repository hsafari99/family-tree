import { describe, expect, it } from 'vitest';
import { bandRows, generationLabel, rowTops } from './generation-labels';
import type { CanvasNode } from './graph-to-flow';
import { CARD_HEIGHT } from './graph-to-flow';

describe('generationLabel', () => {
  it('names generations relative to the anchor', () => {
    expect(generationLabel(0)).toBe('You');
    expect(generationLabel(0, 'Leo')).toBe('Leo');
    expect(generationLabel(-1)).toBe('Parents');
    expect(generationLabel(-2)).toBe('Grandparents');
    expect(generationLabel(-3)).toBe('Great-grandparents');
    expect(generationLabel(-4)).toBe('2× great-grandparents');
    expect(generationLabel(-6)).toBe('4× great-grandparents');
    expect(generationLabel(1)).toBe('Children');
    expect(generationLabel(2)).toBe('Grandchildren');
    expect(generationLabel(3)).toBe('Great-grandchildren');
    expect(generationLabel(5)).toBe('3× great-grandchildren');
  });
});

const person = (id: string, x: number, y: number) =>
  ({ id: `p:${id}`, type: 'person', position: { x, y }, data: {} }) as unknown as CanvasNode;
const dot = (id: string, y: number) =>
  ({ id: `u:${id}`, type: 'union', position: { x: 0, y }, data: {} }) as unknown as CanvasNode;

describe('rows from the layout', () => {
  const nodes = [
    person('a', 0, 0),
    person('b', 232, 0),
    dot('ab', 24),
    person('c', 100, 128),
    person('d', 0, 256),
  ];
  const gens = new Map([
    ['a', 0],
    ['b', 0],
    ['c', 1],
    ['d', 2],
  ]);

  it('gives each generation row its top y, top to bottom', () => {
    expect(rowTops(nodes, gens)).toEqual([
      { generation: 0, y: 0 },
      { generation: 1, y: 128 },
      { generation: 2, y: 256 },
    ]);
  });

  it('bands each row out to halfway to its neighbours, labelled from the anchor', () => {
    const rows = bandRows(rowTops(nodes, gens), gens, 'c', 'Cat');
    expect(rows.map((r) => r.label)).toEqual(['Parents', 'Cat', 'Children']);
    const gap = (128 - CARD_HEIGHT) / 2;
    expect(rows[1]).toMatchObject({
      top: 128 - gap,
      bottom: 128 + CARD_HEIGHT + gap,
      cardsTop: 128,
    });
    expect(rows[0]!.bottom).toBe(rows[1]!.top);
  });

  it('numbers the rows without an anchor, and has none without generations', () => {
    expect(bandRows(rowTops(nodes, gens), gens, null, 'You').map((r) => r.label)).toEqual([
      'Generation 1',
      'Generation 2',
      'Generation 3',
    ]);
    expect(rowTops(nodes, null)).toEqual([]);
  });
});
