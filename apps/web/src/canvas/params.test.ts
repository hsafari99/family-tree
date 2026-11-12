import { describe, expect, it } from 'vitest';
import { canvasSearch, graphModeOf, readCanvasParams } from './params';

const sp = (s: string) => new URLSearchParams(s);

describe('canvas URL parameters', () => {
  it('reads defaults and ignores nonsense', () => {
    expect(readCanvasParams(sp(''))).toEqual({
      view: 'focus',
      depth: 1,
      gens: 4,
      branch: null,
      focus: null,
    });
    expect(readCanvasParams(sp('view=full&depth=9&branch=b'))).toEqual({
      view: 'full',
      depth: 1,
      gens: 4,
      branch: 'b',
      focus: null,
    });
    expect(readCanvasParams(sp('depth=3&focus=f')).depth).toBe(3);
    expect(readCanvasParams(sp('view=nope')).view).toBe('focus');
  });
  it('reads the fan and tree views and their generations (1 to 6)', () => {
    expect(readCanvasParams(sp('view=fan&gens=6'))).toMatchObject({ view: 'fan', gens: 6 });
    expect(readCanvasParams(sp('view=tree&gens=1'))).toMatchObject({ view: 'tree', gens: 1 });
    for (const g of ['0', '7', 'x', '2.5'])
      expect(readCanvasParams(sp(`view=fan&gens=${g}`)).gens).toBe(4);
  });
  it('maps each view to its graph mode', () => {
    expect(['focus', 'full', 'fan', 'tree'].map((v) => graphModeOf(v as never))).toEqual([
      'focus',
      'full',
      'ancestors',
      'descendants',
    ]);
  });
  it('applies changes, drops nulls and defaults, keeps the rest', () => {
    expect(canvasSearch(sp('view=full&tab=history'), { tab: null })).toBe('?view=full');
    expect(canvasSearch(sp('depth=2'), { view: 'focus', depth: 1 })).toBe('');
    expect(canvasSearch(sp('depth=2&tab=info'), { tab: 'relations', add: 'child' })).toBe(
      '?depth=2&tab=relations&add=child',
    );
    expect(canvasSearch(sp('view=fan'), { gens: 4 })).toBe('?view=fan');
    expect(canvasSearch(sp('view=fan'), { gens: 6 })).toBe('?view=fan&gens=6');
  });
  it('drops from and to', () => {
    expect(canvasSearch(sp('from=a&to=b&view=full'), { from: null, to: null })).toBe('?view=full');
  });
});
