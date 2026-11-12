import { describe, expect, it } from 'vitest';
import { bandRows, generationLabel, gutterLabels, rowTops } from './generation-labels';
import type { CanvasNode } from './graph-to-flow';
import { CARD_HEIGHT } from './graph-to-flow';

describe('generationLabel', () => {
  it('names a generation, not people, relative to the anchor', () => {
    expect(generationLabel(0)).toBe('Your generation');
    expect(generationLabel(0, 'Leo')).toBe('Leo’s generation');
    expect(generationLabel(-1)).toBe('Parents’ generation');
    expect(generationLabel(-2)).toBe('Grandparents’ generation');
    expect(generationLabel(-3)).toBe('Great-grandparents’ generation');
    expect(generationLabel(-4)).toBe('2× great-grandparents’ generation');
    expect(generationLabel(-6)).toBe('4× great-grandparents’ generation');
    expect(generationLabel(1)).toBe('Children’s generation');
    expect(generationLabel(2)).toBe('Grandchildren’s generation');
    expect(generationLabel(3)).toBe('Great-grandchildren’s generation');
    expect(generationLabel(5)).toBe('3× great-grandchildren’s generation');
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
    expect(rows.map((r) => r.label)).toEqual([
      'Parents’ generation',
      'Cat’s generation',
      'Children’s generation',
    ]);
    const gap = (128 - CARD_HEIGHT) / 2;
    expect(rows[1]).toMatchObject({
      top: 128 - gap,
      bottom: 128 + CARD_HEIGHT + gap,
      cardsTop: 128,
    });
    expect(rows[0]!.bottom).toBe(rows[1]!.top);
  });

  it('numbers the rows without an anchor, and has none without generations', () => {
    expect(bandRows(rowTops(nodes, gens), gens, null, null).map((r) => r.label)).toEqual([
      'Generation 1',
      'Generation 2',
      'Generation 3',
    ]);
    expect(rowTops(nodes, null)).toEqual([]);
  });
});

describe('gutter labels', () => {
  const bands = [
    { label: 'A', top: -40, bottom: 100, cardsTop: 0 },
    { label: 'B', top: 100, bottom: 300, cardsTop: 128 },
  ];
  it('centres each label on its band on screen, at any zoom', () => {
    expect(gutterLabels(bands, 10, 0.5)).toEqual([
      { label: 'A', top: -10, height: 70, centre: 25, shaded: true },
      { label: 'B', top: 60, height: 100, centre: 110, shaded: false },
    ]);
    // Zoomed far out (the strip above a row is a few px): every label is still there.
    expect(gutterLabels(bands, 0, 0.26).map((l) => l.label)).toEqual(['A', 'B']);
  });
  it('has none at the dot zoom', () => {
    expect(gutterLabels(bands, 0, 0.2)).toEqual([]);
  });
});
