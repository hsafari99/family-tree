import { describe, expect, it } from 'vitest';
import {
  canvasSettings,
  cardDetail,
  isNodeVisible,
  orderAfterDrag,
  reorderAfterDrop,
} from './canvas-settings';

describe('canvas settings', () => {
  it('simplifies cards as you zoom out', () => {
    expect([1, 0.55, 0.54, 0.25, 0.24, 0.05].map(cardDetail)).toEqual([
      'full',
      'full',
      'compact',
      'compact',
      'dot',
      'dot',
    ]);
  });
  it('turns on the performance guard for big views', () => {
    expect(canvasSettings(299)).toEqual({ onlyRenderVisibleElements: false, showMiniMap: true });
    expect(canvasSettings(300).onlyRenderVisibleElements).toBe(true);
    expect(canvasSettings(1501).showMiniMap).toBe(false);
  });
  it('knows when a card is inside the visible pane', () => {
    const pane = { width: 800, height: 600 };
    const size = { width: 200, height: 72 };
    expect(isNodeVisible({ x: 100, y: 100 }, size, { x: 0, y: 0, zoom: 1 }, pane)).toBe(true);
    expect(isNodeVisible({ x: 700, y: 100 }, size, { x: 0, y: 0, zoom: 1 }, pane)).toBe(false);
    expect(isNodeVisible({ x: 700, y: 100 }, size, { x: -400, y: 0, zoom: 1 }, pane)).toBe(true);
  });
  it('orders dragged siblings by x', () => {
    expect(
      orderAfterDrag(
        ['a', 'b', 'c'],
        new Map([
          ['a', 300],
          ['b', 0],
          ['c', 150],
        ]),
      ),
    ).toEqual(['b', 'c', 'a']);
  });

  it('computes the order after a drop, or null when unchanged', () => {
    const families = [{ id: 'u-dl', partnerIds: ['david', 'laura'], childIds: ['leo', 'mia'] }];
    const x = (leo: number, mia: number) =>
      new Map([
        ['leo', leo],
        ['mia', mia],
      ]);
    expect(reorderAfterDrop(families, 'u-dl', x(400, 100))).toEqual(['mia', 'leo']);
    expect(reorderAfterDrop(families, 'u-dl', x(100, 400))).toBeNull();
    expect(reorderAfterDrop(families, 'nope', x(400, 100))).toBeNull();
  });
});
