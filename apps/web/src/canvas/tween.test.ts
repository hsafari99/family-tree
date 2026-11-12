import { describe, expect, it } from 'vitest';
import type { CanvasNode } from './graph-to-flow';
import { easeOutCubic, positionsOf, tweenPositions } from './tween';
import { gp } from './test-fixtures';

const node = (id: string, x: number, y: number, className?: string): CanvasNode => ({
  id,
  type: 'person',
  position: { x, y },
  data: {
    person: gp(id, id, null),
    isFocus: false,
    isMe: false,
    reorderUnionId: null,
    coupleDrag: false,
  },
  ...(className ? { className } : {}),
});

const from = new Map([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 100, y: 50 }],
  ['gone', { x: 7, y: 7 }],
]);
const to = [node('a', 200, 100), node('b', 100, 50, 'is-dim'), node('new', 300, 0)];

describe('easeOutCubic', () => {
  it('runs from 0 to 1 and never goes back', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Ease out: most of the way in the first half.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
  });
  it('clamps outside 0..1', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('tweenPositions', () => {
  it('puts the nodes at their old places at t=0 and at the new ones at t=1', () => {
    const start = tweenPositions(from, to, 0);
    expect(start.find((n) => n.id === 'a')!.position).toEqual({ x: 0, y: 0 });
    const end = tweenPositions(from, to, 1);
    expect(end.find((n) => n.id === 'a')!.position).toEqual({ x: 200, y: 100 });
    expect(end.find((n) => n.id === 'b')!.position).toEqual({ x: 100, y: 50 });
  });
  it('moves along the eased curve between', () => {
    const mid = tweenPositions(from, to, 0.5).find((n) => n.id === 'a')!;
    const k = easeOutCubic(0.5);
    expect(mid.position.x).toBeCloseTo(200 * k);
    expect(mid.position.y).toBeCloseTo(100 * k);
  });
  it('keeps everything else about a node, its class too', () => {
    const b = tweenPositions(from, to, 0.3).find((n) => n.id === 'b')!;
    expect(b.className).toBe('is-dim');
    expect(b.data).toBe(to[1]!.data);
  });
  it('starts a new node at its final place, marked as entering', () => {
    for (const t of [0, 0.5]) {
      const n = tweenPositions(from, to, t).find((x) => x.id === 'new')!;
      expect(n.position).toEqual({ x: 300, y: 0 });
      expect(n.className).toBe('is-entering');
    }
    const dim = tweenPositions(new Map(), [node('c', 0, 0, 'is-dim')], 0)[0]!;
    expect(dim.className).toBe('is-dim is-entering');
  });
  it('drops a node that is not in the new layout', () => {
    expect(tweenPositions(from, to, 0).map((n) => n.id)).toEqual(['a', 'b', 'new']);
  });
  it('positionsOf maps ids to positions', () => {
    expect(positionsOf(to).get('a')).toEqual({ x: 200, y: 100 });
  });
});
