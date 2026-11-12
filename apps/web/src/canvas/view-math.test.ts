import { describe, expect, it } from 'vitest';
import { centredOn, focusZoom, isClear, onScreen, pinnedAt } from './view-math';

const pane = { width: 1000, height: 600 };
const none = { right: 0, bottom: 0, boxes: [] };

describe('view math', () => {
  it('a card is clear on the pane, but not under the sheet or a floating box', () => {
    const card = { x: 700, y: 450, width: 200, height: 72 };
    expect(isClear(card, pane, none)).toBe(true);
    expect(isClear(card, pane, { ...none, bottom: 200 })).toBe(false);
    const map = { x: 650, y: 420, width: 200, height: 150 };
    expect(isClear(card, pane, { ...none, boxes: [map] })).toBe(false);
    expect(isClear({ ...card, x: -1 }, pane, none)).toBe(false);
  });

  it('centres a point in the uncovered part', () => {
    expect(centredOn(100, 50, 2, pane, { right: 0, bottom: 0 })).toEqual({
      x: 300,
      y: 200,
      zoom: 2,
    });
    // The sheet covers the lower 400px: the point goes in the middle of the 200px above it.
    expect(centredOn(100, 50, 1, pane, { right: 64, bottom: 400 })).toEqual({
      x: 368,
      y: 50,
      zoom: 1,
    });
  });

  it('pins a point to a screen place, and maps boxes to the screen', () => {
    const vp = pinnedAt({ x: 300, y: 200 }, { x: 50, y: 25 }, 2);
    expect(onScreen({ x: 50, y: 25, width: 10, height: 5 }, vp)).toEqual({
      x: 300,
      y: 200,
      width: 20,
      height: 10,
    });
  });
});

describe('focusZoom', () => {
  it('keeps the fitted zoom, but never below the compact cards', () => {
    expect(focusZoom(0.8)).toBe(0.8);
    expect(focusZoom(0.12)).toBe(0.4);
    expect(focusZoom(2)).toBe(1.1);
  });
});
