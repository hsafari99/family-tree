import { describe, expect, it } from 'vitest';
import { canvasSearch, readCanvasParams } from './params';

const sp = (s: string) => new URLSearchParams(s);

describe('canvas URL parameters', () => {
  it('reads defaults and ignores nonsense', () => {
    expect(readCanvasParams(sp(''))).toEqual({
      mode: 'focus',
      depth: 1,
      branch: null,
      focus: null,
    });
    expect(readCanvasParams(sp('view=full&depth=9&branch=b'))).toEqual({
      mode: 'full',
      depth: 1,
      branch: 'b',
      focus: null,
    });
    expect(readCanvasParams(sp('depth=3&focus=f')).depth).toBe(3);
  });
  it('applies changes, drops nulls and defaults, keeps the rest', () => {
    expect(canvasSearch(sp('view=full&tab=history'), { tab: null })).toBe('?view=full');
    expect(canvasSearch(sp('depth=2'), { view: 'focus', depth: 1 })).toBe('');
    expect(canvasSearch(sp('depth=2&tab=info'), { tab: 'relations', add: 'child' })).toBe(
      '?depth=2&tab=relations&add=child',
    );
  });
  it('drops from and to', () => {
    expect(canvasSearch(sp('from=a&to=b&view=full'), { from: null, to: null })).toBe('?view=full');
  });
});
